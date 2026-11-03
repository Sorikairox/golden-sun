"""Object and link stages of the wasm build (tools/wasm/build.py).

obj:  each bound module (build/wasm/bound/*.ll, the game's and port/pc's) -> wasm object; build/wasm/gen too.
link: works out what is still undefined (llvm-nm), then generates build/wasm/gen/glue.ll:
  - far-call veneers: the game calls another bank's routine through a stub NAMEFar (gamepak/far_call/*.s
    `export NAME, TARGET`), and overlays call the main image through import stubs
    (system/overlay/imports.inc `import NAME, TARGET`); each becomes a function NAME that calls TARGET;
  - main-image references to a routine one overlay defines go to that overlay's ovNNN_ copy;
  - every other undefined function becomes a logged stub (Port_StubHit) with the signature its callers use;
then links game.js + game.wasm with emcc: no memory growth, 225 MB of linear memory (D5).
Writes build/wasm/stubs.tsv (name, kind: asm | port | other) and prints the counts.
"""
import concurrent.futures as cf
import glob
import os
import re
import subprocess
from collections import defaultdict

import game
import overlay_imports

NM = '/emsdk/upstream/bin/llvm-nm'
TYPES = ('void', 'i1', 'i8', 'i16', 'i32', 'i64', 'float', 'double', 'ptr')
# 230400 KB = 0x0E100000: linear memory up to the end of the 64 KB flash at 0x0E000000 (D5)
LINK_FLAGS = ['-sINITIAL_MEMORY=230400kb', '-sALLOW_MEMORY_GROWTH=0', '-sSTACK_SIZE=1048576',
              '-sERROR_ON_UNDEFINED_SYMBOLS=1', '-sEXIT_RUNTIME=0', '-sENVIRONMENT=web,node',
              '-O2',
              # the frame driver hands each frame to the host and may be suspended there (port/web/port_lib.js)
              '--profiling-funcs',  # function names in traces (no data)
              '-sASYNCIFY=1', '-sASYNCIFY_STACK_SIZE=65536',
              # a factory (GoldenSun(opts)) that does not run main by itself: the page or test harness first
              # writes the player's ROM to 0x08000000
              '-sMODULARIZE=1', '-sEXPORT_NAME=GoldenSun', '-sINVOKE_RUN=0',
              '-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,HEAPU32,ccall,callMain',
              # keep every game function and overlay even before anything calls it: the G2 check is that all
              # of them link; G3's boot path will make them reachable
              '-Wl,--no-gc-sections',
              # function pointers start at 65536: the game stores code addresses and message ids in the same
              # words and tells them apart by size (TRIGGER_RESULT_MESSAGE_END), so a table index must not look
              # like a message id (port/pc/gba.h PORT_TABLE_BASE)
              '-sTABLE_BASE=65536',
              # emscripten's data and stack above the table indices: [0x10000, 0x20000) is never an address
              '-sGLOBAL_BASE=131072',
              # indirect calls whose function type differs from the target's (a step trigger's routine called as
              # void(s32) that takes nothing...): on the ARM extra or missing words in r0-r3 are harmless, in wasm
              # call_indirect traps; this makes every indirect call tolerate it, as the GBA does
              '-sEMULATE_FUNCTION_POINTER_CASTS=1']


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def veneer_map(root):
    """NAME -> TARGET from the far-call tables and the overlay import list."""
    tbs = os.path.join(game.C.vendor, 'src')
    out = {}
    files = glob.glob(os.path.join(tbs, 'gamepak/far_call/*.[sS]')) + [os.path.join(tbs, 'system/overlay/imports.inc')]
    for p in files:
        for line in open(p, encoding='utf-8', errors='replace'):
            m = re.match(r'\s*(export|import)\s+([\w.]+)\s*,\s*([\w.]+)', line)
            if m and m.group(2) != 'name':
                out.setdefault(m.group(2), m.group(3))
    out.update(overlay_imports.veneer_map())  # TLA: ovNNN_NAME -> the overlay's import target (TLA2b)
    if game.C.game == 'tla':
        # TLA4b (hook H3): port/tla/hw/bindings.tsv's binds (PC layer) and GS1 twins (port/pc files linked as
        # `twins`, port/tla/pc.tsv) answer for their labels; a2c rows come from asm2c's names.tsv, veneers above
        for line in open(os.path.join(root, 'port/tla/hw/bindings.tsv'), encoding='utf-8'):
            f = line.rstrip('\n').split('\t')
            if len(f) > 2 and not line.startswith('#') and f[2] in ('bind', 'gs1') and f[0] != f[1] and f[1] != 'main':
                out.setdefault(f[0], f[1])
        # the mixer's ROM load-address label calls the IWRAM translation (H4: hw2c translates at the run address)
        out.setdefault('Sound_Mixer', 'SoundDriver_Mixer')
    return out


def signatures(ll_files):
    """name -> (ret, [param types], variadic) from define/declare lines."""
    sig = {}
    rx = re.compile(r'^(define|declare)\b(.*?)@(?:"([^"]+)"|([-\w$.]+))\((.*)\)')
    for p in ll_files:
        for line in open(p, encoding='utf-8'):
            if not line.startswith(('define', 'declare')):
                continue
            m = rx.match(line)
            if not m:
                continue
            name = m.group(3) or m.group(4)
            ret = next((t for t in reversed(m.group(2).split()) if t in TYPES), 'void')
            params_s = m.group(5)
            # strip a trailing ") attrs {" part kept by the greedy match
            depth, cut = 0, len(params_s)
            for i, ch in enumerate(params_s):
                if ch == '(':
                    depth += 1
                elif ch == ')':
                    if depth == 0:
                        cut = i
                        break
                    depth -= 1
            params_s = params_s[:cut]
            params, variadic = [], False
            parts, depth, cur = [], 0, ''
            for ch in params_s:
                if ch == ',' and depth == 0:
                    parts.append(cur)
                    cur = ''
                    continue
                depth += (ch == '(') - (ch == ')')
                cur += ch
            parts.append(cur)
            for part in [x.strip() for x in parts if x.strip()]:
                if part == '...':
                    variadic = True
                    continue
                params.append(part.split()[0])
            if m.group(1) == 'define' or name not in sig:
                sig[name] = (ret, params, variadic)
    return sig


def convert(val, frm, to, tmp):
    """IR lines converting `val` of type `frm` to `to` (integers by zext/trunc, pointers by int casts); returns
    (lines, value)."""
    if frm == to:
        return [], val
    bits = lambda t: 32 if t == 'ptr' else int(t[1:]) if t.startswith('i') else None
    if bits(frm) is None or bits(to) is None:
        return [], zero(to) or 'undef'
    lines, v, f = [], val, frm
    if f == 'ptr':
        lines.append(f'  %{tmp}p = ptrtoint ptr {v} to i32'); v, f = f'%{tmp}p', 'i32'
    t2 = 'i32' if to == 'ptr' else to
    if bits(f) < bits(t2):
        lines.append(f'  %{tmp}x = zext {f} {v} to {t2}'); v = f'%{tmp}x'
    elif bits(f) > bits(t2):
        lines.append(f'  %{tmp}t = trunc {f} {v} to {t2}'); v = f'%{tmp}t'
    if to == 'ptr':
        lines.append(f'  %{tmp}q = inttoptr i32 {v} to ptr'); v = f'%{tmp}q'
    return lines, v


def adapter(ret, params, tret, tparams, target):
    """Body of a veneer whose callers declare (ret, params) for a target defined as (tret, tparams): on the GBA
    both pass words in r0-r3 and return r0, so arguments are converted word for word, missing ones are 0, extra
    ones dropped, a missing result is 0 (wasm-ld would otherwise turn the call into a trap)."""
    lines, args = [], []
    for i, t in enumerate(tparams):
        if i < len(params):
            l, v = convert(f'%a{i}', params[i], t, f'c{i}')
            lines += l
        else:
            v = zero(t) or 'undef'
        args.append(f'{t} {v}')
    call = f'call {tret} @"{target}"({", ".join(args)})'
    if tret == 'void':
        lines.append(f'  {call}')
        lines.append(f'  ret {ret} {zero(ret)}' if ret != 'void' else '  ret void')
    else:
        lines.append(f'  %r = {call}')
        if ret == 'void':
            lines.append('  ret void')
        else:
            l, v = convert('%r', tret, ret, 'cr')
            lines += l + [f'  ret {ret} {v}']
    return '\n'.join(lines)


CALL_RX = re.compile(r'\bcall (\S+) @(?:"([^"]+)"|([-\w$.]+))\(')
# the same with return attributes (`call zeroext i8 @f(`), for adapt_mismatched_calls (TLA)
CALL_RX_ATTRS = re.compile(r'\bcall (?:(?:zeroext|signext|noundef|noalias|nonnull|inreg)\s+)*(\S+) @(?:"([^"]+)"|([-\w$.]+))\(')


def split_args(text, start):
    """The top-level argument list of a call starting after its '(' at `start`: (types, end index)."""
    depth, cur, parts, i = 0, '', [], start
    while i < len(text):
        ch = text[i]
        if ch == ')' and depth == 0:
            break
        if ch == ',' and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            depth += (ch in '([{<') - (ch in ')]}>')
            cur += ch
        i += 1
    parts.append(cur)
    return [p.strip().split()[0] for p in parts if p.strip()], i


def adapt_unprototyped_calls(files):
    """Calls of functions declared without a prototype (K&R `f()`, IR `(...)`) pass whatever the caller wrote
    (the vendor's Import_ActorSetAnimation takes two words, some scenes pass three); wasm needs one signature per
    symbol or wasm-ld turns the call into a trap. Each such call is sent to `NAME$c<signature>`, an adapter that
    link generates (converting word for word, as r0-r3 would carry them). Rewrites the bound IR in place
    (idempotent: adapters are not `(...)`). Returns {adapter: (ret, params, name)}."""
    adapters = {}
    rx_decl = re.compile(r'^declare (\S+) @(?:"([^"]+)"|([-\w$.]+))\(\.\.\.\)', re.M)
    for path in files:
        text = open(path, encoding='utf-8').read()
        knr = {m.group(2) or m.group(3) for m in rx_decl.finditer(text)}
        if not knr:
            continue
        out, pos, new = [], 0, {}
        for m in CALL_RX.finditer(text):
            name = m.group(2) or m.group(3)
            if name not in knr or m.start() < pos:
                continue
            types, _ = split_args(text, m.end())
            ret = m.group(1)
            if ret == '(...)' or ret.endswith(')'):
                continue
            a = f'{name}$c{ret}_' + '_'.join(types)
            adapters[a] = (ret, types, name)
            new[a] = (ret, types)
            out.append(text[pos:m.start()] + f'call {ret} @"{a}"(')
            pos = m.end()
        if not new:
            continue
        out.append(text[pos:])
        text = ''.join(out)
        have = set(re.findall(r'^declare \S+ @"([^"]+\$c[^"]*)"', text, re.M))
        decls = ''.join(f'\ndeclare {r} @"{a}"({", ".join(t)})' for a, (r, t) in sorted(new.items()) if a not in have)
        open(path, 'w', encoding='utf-8').write(text + decls + '\n')
    # adapters already in the IR from an earlier run (the rewrite is done once per bound file)
    rx_ad = re.compile(r'^declare (\S+) @"(([^"$]+)\$c[^"]*)"\(([^)]*)\)', re.M)
    for path in files:
        for m in rx_ad.finditer(open(path, encoding='utf-8').read()):
            adapters[m.group(2)] = (m.group(1), [t.strip() for t in m.group(4).split(',') if t.strip()], m.group(3))
    return adapters


def adapt_mismatched_calls(files):
    """TLA (TLA2): the same function declared with other prototypes in other translation units (a scene's
    `void Func_020007bc(s32)` against another's `s32 Func_020007bc(void)`, a RAM routine named by its address) is
    one wasm import with several types, and wasm-ld warns and traps the calls. On the ARM all of them pass words in
    r0-r3. The canonical type is the definition's, else the most common declaration's; every call that declares
    another type goes to `NAME$c<signature>`, the same per-signature adapter as adapt_unprototyped_calls (link
    generates it). Rewrites the bound IR in place (idempotent)."""
    from collections import Counter
    rx_decl = re.compile(r'^declare (?:[^@]*?\s)?(\S+) @(?:"([^"]+)"|([-\w$.]+))\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)', re.M)
    rx_def = re.compile(r'^define (?:[^@]*?\s)?(\S+) @(?:"([^"]+)"|([-\w$.]+))\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)', re.M)

    def ptypes(p):
        for _ in range(3):  # attribute arguments: captures(none), dereferenceable(86), initializes((8, 12))
            p = re.sub(r'\([^()]*\)', '', p)
        return tuple(x.strip().split()[0] for x in p.split(',') if x.strip())

    def ok(ret, types):  # plain word types only (a byval or dereferenceable(..) list is left as it is)
        return ret in TYPES and all(t in TYPES for t in types)
    defs, decls, per_file = {}, Counter(), {}
    for path in files:
        text = open(path, encoding='utf-8').read()
        for m in rx_def.finditer(text):
            if ok(m.group(1), ptypes(m.group(4))):
                defs[m.group(2) or m.group(3)] = (m.group(1), ptypes(m.group(4)))
        mine = {}
        for m in rx_decl.finditer(text):
            if '...' in m.group(4) or '$c' in (m.group(2) or m.group(3)) or \
                    not ok(m.group(1), ptypes(m.group(4))):
                continue
            n, sg = m.group(2) or m.group(3), (m.group(1), ptypes(m.group(4)))
            mine[n] = sg
            decls[(n, sg)] += 1
        per_file[path] = mine
    best = {}
    for (n, sg), c in decls.items():
        if n not in best or c > decls[(n, best[n])]:
            best[n] = sg
    canon = dict(best)
    canon.update(defs)
    adapt_mismatched_calls.canon = canon
    adapters = {}
    for path, mine in per_file.items():
        bad = {n: sg for n, sg in mine.items() if canon.get(n, sg) != sg}
        if not bad:
            continue
        text = open(path, encoding='utf-8').read()
        out, pos, new = [], 0, {}
        for m in CALL_RX_ATTRS.finditer(text):
            name = m.group(2) or m.group(3)
            if name not in bad or m.start() < pos:
                continue
            types, _ = split_args(text, m.end())  # the call site's own type (it may differ from the declaration)
            ret = m.group(1)
            if ret == '(...)' or ret.endswith(')'):
                continue
            a = f'{name}$c{ret}_' + '_'.join(types)
            adapters[a] = (ret, list(types), name)
            new[a] = (ret, types)
            out.append(text[pos:m.start()] + f'call {ret} @"{a}"(')
            pos = m.end()
        if not new:
            continue
        out.append(text[pos:])
        text = ''.join(out)
        have = set(re.findall(r'^declare \S+ @"([^"]+\$c[^"]*)"', text, re.M))
        text += ''.join(f'\ndeclare {r} @"{a}"({", ".join(t)})' for a, (r, t) in sorted(new.items()) if a not in have)
        open(path, 'w', encoding='utf-8').write(text + '\n')
    return adapters


def zero(ret):
    return {'void': None, 'ptr': 'null', 'float': '0.0', 'double': '0.0'}.get(ret, '0')


def run(objs, out, root, clang, jobs, stages):
    obj_dir = os.path.join(out, 'obj')
    os.makedirs(obj_dir, exist_ok=True)
    bound = [os.path.join(out, 'bound', b + '.ll') for b in game.bound_names(objs)]
    cfiles = [os.path.join(out, 'gen/relocated.c')]
    if game.C.game == 'tla' and os.path.exists(os.path.join(out, 'asm2c/tla_asm.c')):
        # TLA5 (D23): the translated listing asm and its run time
        # (TLA4b: split into units, build.py split_asm2c)
        parts = sorted(glob.glob(os.path.join(out, 'asm2c/tla_asm_*.c')))
        cfiles += (parts or [os.path.join(out, 'asm2c/tla_asm.c')]) + [os.path.join(root, 'port/tla/a2c/a2c_rt.c')]

    def compile_one(src):
        rel = os.path.relpath(src, root).replace('/', '__')
        o = os.path.join(obj_dir, rel + '.o')
        flags = ['--target=wasm32-unknown-emscripten', '-O2', '-c', '-o', o, src]
        if src.endswith('.c'):
            cmd = ['emcc', '-O2', '-c', '-o', o, src]
            if '/asm2c/tla_asm' in src:  # TLA4b: generated code: its style warnings say nothing
                cmd.insert(2, '-w')
        else:
            cmd = [clang] + flags
        if os.path.exists(o) and '/asm2c/tla_asm' in src:
            os.remove(o)
        rc, _, err = sh(cmd)
        return o, (err[-1500:] if rc else None)
    if game.C.game != 'tbs' and ('obj' in stages or 'link' in stages):
        adapt_mismatched_calls(bound)
    adapters = adapt_unprototyped_calls(bound) if 'obj' in stages or 'link' in stages else {}
    if 'obj' in stages:
        fails = []
        # TLA4b: asm2c's units need about a GB each at -O2: they compile after the rest, three at a time (the
        # Docker VM has 8 GB; ten at once were killed, exit 137, leaving no object)
        heavy = [c for c in cfiles if '/asm2c/tla_asm' in c]
        light = [c for c in bound + cfiles if c not in heavy]
        for todo, nj in ((light, jobs), (heavy, min(jobs, 3))):
            with cf.ThreadPoolExecutor(nj) as ex:
                for o, err in ex.map(compile_one, todo):
                    if err is None and not os.path.exists(o):
                        err = 'no object written (compiler killed?)'
                    if err:
                        fails.append((o, err))
        print(f'obj: {len(bound) + len(cfiles) - len(fails)}/{len(bound) + len(cfiles)} objects')
        for o, err in fails[:10]:
            print('  FAIL', os.path.basename(o), next((l for l in err.splitlines() if 'error' in l), err[:300]))
        if fails:
            return False
    if 'link' not in stages:
        return True
    objects = sorted(glob.glob(os.path.join(obj_dir, '*.o')))
    vendor_prefix = os.path.relpath(os.path.join(out, 'bound', 'src'), root).replace('/', '__') + '__'
    want = {os.path.relpath(b, root).replace('/', '__') + '.o' for b in bound}

    def current(objects):
        # TLA (TLA2b): only this build's vendor modules; an object of a module no longer built (a shared object
        # now bound once per overlay, path@NNN; a left-out object) would link twice
        if game.C.game == 'tbs':
            return objects
        return [o for o in objects if not os.path.basename(o).startswith(vendor_prefix) or os.path.basename(o) in want]
    objects = current([o for o in objects if not o.endswith(('glue.ll.o', 'reloc_table.ll.o', 'code_map.ll.o'))])
    defined, undefined = set(), defaultdict(set)
    for o in objects:
        rc, so, _ = sh([NM, o])
        for line in so.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[0] == 'U':
                undefined[parts[1]].add(os.path.basename(o))
            elif len(parts) == 3 and parts[1] in 'TDBRVWtdbr':
                defined.add(parts[2])
    libc = {'memcpy', 'memset', 'memmove', 'printf', 'iprintf', 'puts', 'fflush', 'stdout', 'putchar', 'abort', 'port_frame_ready', 'port_soft_reset', 'port_link_connected', 'port_link_player_id', 'port_link_send', 'port_link_recv', 'abort', 'malloc', 'free', 'strlen', 'memcmp',
            '__stack_pointer', '__heap_base', '__indirect_function_table', '__memory_base', '__table_base',
            'emscripten_stack_get_current', '__stack_low', '__stack_high', '__data_end'}
    missing = {n: u for n, u in undefined.items() if n not in defined and n not in libc and n not in adapters}
    for a, (_, _, name) in adapters.items():  # an adapter's target needs its veneer or stub like any other call
        if name not in defined and name not in libc:
            missing.setdefault(name, set()).add('(K&R calls)')
    sig = signatures(bound + [os.path.join(out, 'll', o + '.ll') for _, o in objs])
    if game.C.game != 'tbs':  # a stub takes the canonical type (adapt_mismatched_calls), not the first one seen
        for n, (r, p) in getattr(adapt_mismatched_calls, 'canon', {}).items():
            sig[n] = (r, list(p), False)
    vmap = veneer_map(root)
    overlay_def = defaultdict(list)
    for d in defined:
        m = re.match(r'ov([0-9a-f]{3})_(.+)$', d)
        if m:
            overlay_def[m.group(2)].append(d)

    # TLA (TLA2b): a veneer chain that ends at a routine nobody defines yet (main asm) gets its stub under that
    # routine's own name, and the veneers call it: one stub per real routine (build/wasm-tla/asm_stubs.tsv)
    chain_stubs = set()
    if game.C.game != 'tbs':
        for name in list(missing):
            end, seen = name, 0
            while end in vmap and end not in defined and seen < 6:
                end, seen = vmap[end], seen + 1
            if end != name and end not in defined and end not in libc and name in sig:
                chain_stubs.add(end)
                missing.setdefault(end, set()).add('(veneer)')
                r_, p_, _ = sig[name]
                sig.setdefault(end, (r_, list(p_), False))  # a K&R caller's veneer takes the stub's fixed type

    def resolve(name, depth=0):
        if name in defined or (depth and name in chain_stubs):
            return name
        if depth > 5:
            return None
        if name in vmap:
            return resolve(vmap[name], depth + 1)
        if len(overlay_def.get(name, [])) == 1:
            return overlay_def[name][0]
        return None
    a2c = a2c_names(out, defined)
    a2c_stats = defaultdict(int)
    lines = ['; generated by tools/wasm/link.py: veneers and logged stubs', 'declare void @Port_StubHit(i32)']
    if a2c:
        lines.append('@a2c_r = external global [20 x i32]')
        for cn in sorted(set(a2c.values())):
            lines.append(f'declare i32 @a2cw{cn[3:]}({", ".join(["i32"] * 13)})')
    stubs, veneers, mismatched = [], 0, 0
    declared = set()
    final_sig = {}
    knr_targets = {n for _, _, n in adapters.values()}
    for name in sorted(missing):
        s = sig.get(name)
        if s is None:
            continue  # data symbol: reported by the link
        ret, params, variadic = s
        target = resolve(name)
        if variadic and not target and name in knr_targets:
            variadic = False  # a stub called only through adapters: no arguments
        plist = ', '.join([f'{t} %a{i}' for i, t in enumerate(params)] + (['...'] if variadic else []))
        if target and target != name and variadic:
            # declared without a prototype (K&R `f()`): callers pass the promoted arguments, so the veneer takes
            # its target's signature
            dt = sig.get(target) or sig.get(re.sub(r'^ov[0-9a-f]{3}_', '', target))
            if dt and not dt[2]:
                ret, params, variadic = dt
                plist = ', '.join(f'{t} %a{i}' for i, t in enumerate(params))
        if target and target != name and not variadic:
            tret, tparams, _ = sig.get(re.sub(r'^ov[0-9a-f]{3}_', '', target), sig.get(target, (ret, params, False)))
            if (tret, tparams) != (ret, params):
                mismatched += 1
            if target not in declared and target not in chain_stubs:
                declared.add(target)
                dt = sig.get(target) or sig.get(re.sub(r'^ov[0-9a-f]{3}_', '', target)) or (ret, params, False)
                lines.insert(2, f'declare {dt[0]} @"{target}"({", ".join(dt[1] + (["..."] if dt[2] else []))})')
            if (tret, tparams) == (ret, params):
                args = ', '.join(f'{t} %a{i}' for i, t in enumerate(params))
                call = f'call {ret} @"{target}"({args})'
                body = f'  %r = {call}\n  ret {ret} %r' if ret != 'void' else f'  {call}\n  ret void'
            else:
                body = adapter(ret, params, tret, tparams, target)
            lines.append(f'define {ret} @"{name}"({plist}) {{\n{body}\n}}')
            final_sig[name] = (ret, params)
            veneers += 1
            continue
        if name in a2c:  # TLA5: a translated routine (asm2c) answers instead of a logged stub
            lines.append(a2c_wrapper(name, ret, params, a2c[name], a2c_stats))
            final_sig[name] = (ret, params)
            sig[name] = (ret, list(params), False)  # the codemap declares it as defined here
            continue
        idx = len(stubs)
        kind = 'port' if name.startswith('Port_') else ('asm' if is_asm(name, root) else 'other')
        stubs.append((name, kind, ','.join(sorted(missing[name]))[:200]))
        z = zero(ret)
        lines.append(f'define {ret} @"{name}"({plist}) {{\n  call void @Port_StubHit(i32 {idx})\n'
                     f'  ret {ret}{" " + z if z else ""}\n}}')
        final_sig[name] = (ret, params)
    if a2c:
        # TLA5: every other translated routine gets its wrapper too (name or ovNNN_name), so the codemap maps its
        # GBA address and C code can call a code pointer the asm stored (four words in, r0 out)
        for name in sorted(a2c):
            if name in final_sig or name in defined or name in missing:
                continue
            lines.append(a2c_wrapper(name, 'i32', ['i32'] * 4, a2c[name], a2c_stats))
            final_sig[name] = ('i32', ['i32'] * 4)
            sig[name] = ('i32', ['i32'] * 4, False)
            a2c_stats['uncalled'] += 1
        print('asm2c binding: ' + ', '.join(f'{k} {v}' for k, v in sorted(a2c_stats.items())))
    # the K&R call adapters (adapt_unprototyped_calls), now that every target has its one signature
    for a, (ret, params, name) in sorted(adapters.items()):
        if name in final_sig:
            tret, tparams = final_sig[name]
        else:
            d = sig.get(name) or (ret, params, False)
            tret, tparams = d[0], d[1]
            if name not in declared and name not in final_sig:
                declared.add(name)
                lines.insert(2, f'declare {tret} @"{name}"({", ".join(tparams)})')
        plist = ', '.join(f'{t} %a{i}' for i, t in enumerate(params))
        lines.append(f'define {ret} @"{a}"({plist}) {{\n{adapter(ret, params, tret, tparams, name)}\n}}')
    names_c = os.path.join(out, 'gen', 'stub_names.c')
    with open(names_c, 'w') as f:
        f.write('/* generated by tools/wasm/link.py */\nconst char *const gPortStubNames[] = {\n')
        for n, _, _ in stubs:
            f.write(f'  "{n}",\n')
        f.write('  0};\n' + f'const int gPortStubCount = {len(stubs)};\n')
    glue = os.path.join(out, 'gen', 'glue.ll')
    open(glue, 'w').write('\n'.join(lines) + '\n')
    import relocs_gen
    stub_names = {n for n, _, _ in stubs}
    veneer_names = {re.match(r'define \S+ @"([^"]+)"', l).group(1) for l in lines if l.startswith('define')}
    reloc_ll = relocs_gen.generate(out, root, sig, defined | stub_names | veneer_names)
    import codemap_gen
    have = defined | stub_names | veneer_names
    def through_veneers(n):  # TLA4b: a veneer label -> the function it leads to (one this link defines)
        for _ in range(6):
            if n in have:
                return n
            if n not in vmap:
                return resolve(n)
            n = vmap[n]
        return None
    codemap_ll = codemap_gen.generate(out, root, sig, have, through_veneers if game.C.game == 'tla' else None)
    for src in (glue, names_c, reloc_ll, codemap_ll):
        o, err = compile_one(src)
        if err:
            print('glue compile failed:', err)
            return False
    with open(os.path.join(out, 'stubs.tsv'), 'w') as f:
        f.write('name\tkind\tcalled_from\n')
        for row in stubs:
            f.write('\t'.join(row) + '\n')
    if game.C.game != 'tbs':  # TLA2b: classes of the stubs (stub_classes.tsv) and the asm list (asm_stubs.tsv)
        import stub_classes
        stub_classes.classify(out)
    kinds = defaultdict(int)
    for _, k, _ in stubs:
        kinds[k] += 1
    print(f'link: {veneers} veneers ({mismatched} with differing signatures), {len(stubs)} logged stubs '
          f'({", ".join(f"{k} {v}" for k, v in sorted(kinds.items()))})')
    objects = current(sorted(glob.glob(os.path.join(obj_dir, '*.o'))))
    # exports: main and every function the PC layer defines (the page, node runners and the differential tests
    # of tests/arm call them)
    exports = {'main'}
    for o in objects:
        # (TLA4b: the TLA build's objects are build__wasm-tla__..., and port/tla/hw's PC-layer files count too)
        pre = f'build__{os.path.basename(out)}__bound__port__'
        if os.path.basename(o).startswith((pre + 'pc__', pre + 'tla__hw__pc_')):
            rc, so, _ = sh([NM, '--defined-only', o])
            exports |= {p[2] for p in (l.split() for l in so.splitlines()) if len(p) == 3 and p[1] == 'T'}
    flags = LINK_FLAGS + ['--js-library', os.path.join(root, 'port/web/port_lib.js'),
                          '-sEXPORTED_FUNCTIONS=' + ','.join('_' + e for e in sorted(exports))]
    rc, so, err = sh(['emcc'] + objects + flags + ['-o', os.path.join(out, 'game.js')])
    errs = [l for l in err.splitlines() if 'error' in l or 'undefined symbol' in l]
    warns = [l for l in err.splitlines() if 'warning' in l]
    if rc:
        print(f'link FAILED ({len(errs)} errors):')
        for l in errs[:25]:
            print('  ' + l[:200])
        return False
    size = os.path.getsize(os.path.join(out, 'game.wasm'))
    print(f'link: game.wasm {size} bytes; {len(warns)} linker warnings')
    for l in warns[:10]:
        print('  ' + l[:200])
    return True


def a2c_names(out, defined):
    """TLA5: {stub name: asm2c function} from build/<out>/asm2c/names.tsv: a main routine by its name, an overlay
    routine as ovNNN_name (bind.py's names, D7, TLA2b). Names some C or port code defines are left to it."""
    path = os.path.join(out, 'asm2c', 'names.tsv')
    if game.C.game == 'tbs' or not os.path.exists(path):
        return {}
    res = {}
    for line in open(path, encoding='utf-8').read().splitlines()[1:]:
        name, ov, _, cn = line.split('\t')
        key = f'ov{ov}_{name}' if ov else name
        if key not in defined:
            res.setdefault(key, cn)
    return res


def a2c_wrapper(name, ret, params, cn, stats):
    """IR of `name` with the signature its callers use, entering asm2c's routine `cn` through its wrapper
    a2cw_<addr>(nstack, r0-r3, 8 stack words): the arguments as words (an i64 takes two, as GCC 2.9x passes it), a
    result from r0 (an i64 from r0:r1, which a2c_enter_wrapped leaves in a2c_r)."""
    body, words = [], []
    for i, t in enumerate(params):
        if t == 'i64':
            body += [f'  %w{i}l = trunc i64 %a{i} to i32', f'  %w{i}s = lshr i64 %a{i}, 32',
                     f'  %w{i}h = trunc i64 %w{i}s to i32']
            words += [f'%w{i}l', f'%w{i}h']
            stats['i64 argument'] += 1
        elif t in ('float', 'double'):
            words.append('0')
            stats['float argument (0)'] += 1
        else:
            l, v = convert(f'%a{i}', t, 'i32', f'w{i}')
            body += l
            words.append(v)
    if len(words) > 12:
        stats['more than 12 argument words (cut)'] += 1
        words = words[:12]
    ns = max(0, len(words) - 4)
    words += ['0'] * (12 - len(words))
    body.append(f'  %r = call i32 @a2cw{cn[3:]}(i32 {ns}, ' + ', '.join(f'i32 {w}' for w in words) + ')')
    if ret == 'void':
        body.append('  ret void')
    elif ret == 'i64':
        body += ['  %r1p = getelementptr i8, ptr @a2c_r, i32 4', '  %r1 = load i32, ptr %r1p',
                 '  %rl = zext i32 %r to i64', '  %rh0 = zext i32 %r1 to i64', '  %rh = shl i64 %rh0, 32',
                 '  %rr = or i64 %rl, %rh', '  ret i64 %rr']
        stats['i64 result'] += 1
    elif ret in ('float', 'double'):
        body.append(f'  ret {ret} 0.0')
        stats['float result (0)'] += 1
    else:
        l, v = convert('%r', 'i32', ret, 'rv')
        body += l + [f'  ret {ret} {v}']
    plist = ', '.join(f'{t} %a{i}' for i, t in enumerate(params))
    stats['bound'] += 1
    return f'define {ret} @"{name}"({plist}) {{\n' + '\n'.join(body) + '\n}'


_asm_names = None


def is_asm(name, root):
    """Is `name` defined by one of the vendor's assembly objects (D6: to be rewritten in C)?"""
    global _asm_names
    if _asm_names is None:
        _asm_names = set()
        rows = [l.split('\t') for l in open(game.sym('MAP.tsv')) if not l.startswith('#')]
        tbs = game.C.vendor
        for r in rows[1:]:
            if len(r) > 6 and r[4] == 'code' and os.path.exists(os.path.join(tbs, r[6] + '.s')):
                _asm_names.add(r[0])
    return name in _asm_names
