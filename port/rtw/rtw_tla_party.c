/* GS37: The Lost Age's party from a Golden Sun save on retrowser.app (included by rtw.c for TLA only). TLA's manifest
 * has "saveFrom": [{ "dir": "" }] (GS1's retrowser.json at the repository root), so the host gives this module GS1's
 * 64 KB flash image at start (rtw_save_from, retrowser spec 4.11), when this device has one.
 *
 * The page's version (port/web/transfer.js, TLA9) runs GS1's own save code in a second module to get the 4,100 bytes
 * FileScreen_Run's cable send puts on the wire (Serial_StartSend(gSaveBuffer, 4100)): Save_ReadPart(file) into
 * gSaveBuffer and Save_ReadPart(file + 3) into gSaveBuffer + 4096. Those routines (system/system/save.c) only copy flash
 * sectors, so here the same choice is made on the image directly:
 *   - a sector is a part when it starts with "CAMELOT", its part id is < 16 and the low 16 bits of the sum of its first
 *     4072 payload bytes equal the header's checksum (Save_InitializeWork); of two copies of a part the higher counter
 *     wins, the earlier sector on a tie, and a counter of 0 is never current (Save_FindLatestSector);
 *   - a file's summary is the first 64 bytes of its part n (header included; Save_LoadFileSummaries): level at 0x1c,
 *     play time at 0x20, cleared at 0x31; the cleared file with the longest play time is taken, the earlier on a tie
 *     (transfer.js gs1Export, docs/TLA9.md 1);
 *   - bytes 0-4079: part n's payload; 4080-4095: 0; 4096-4099: the first 4 of part n + 3's payload (both parts must
 *     exist, else nothing is sent, as Save_ReadPart's error stops gs1Export).
 * Then Port_TlaAutoTransferArm(1) (port/tla/hw/pc_tla.c): after "Transfer data from Golden Sun?" -> Yes the Transfer
 * Method menu answers Link cable by itself, and rtw_glue.js plays GS1's side of the cable with these bytes. */
#define GS1_SECTOR 4096
#define GS1_SECTORS 16
#define GS1_PAYLOAD 4080
#define GS1_SEND 4100

void Port_TlaAutoTransferArm(int on);

static u8 sGs1Flash[FLASH_SIZE];
static int sGs1Given;
static u8 sParty[GS1_SEND];
static int sPartyLen;
static int sPartyFile = -1, sPartyLevel;

/* the host's copy of GS1's save (manifest saveFrom[0]) */
RTW int rtw_save_from(int index, int size) {
  if (index != 0 || size != FLASH_SIZE || sStarted)
    return 0;
  sGs1Given = 1;
  return (int)(uintptr_t)sGs1Flash;
}

static u32 rd16(const u8 *p) { return p[0] | p[1] << 8; }
static u32 rd32(const u8 *p) { return p[0] | p[1] << 8 | p[2] << 16 | (u32)p[3] << 24; }

/* the current sector of part `part`, or -1 */
static int gs1_part(const int *valid, int part) {
  int best = -1;
  u32 counter = 0;
  for (int i = 0; i < GS1_SECTORS; i++) {
    const u8 *s = sGs1Flash + i * GS1_SECTOR;
    if (valid[i] && s[7] == part && counter < rd16(s + 10)) {
      counter = rd16(s + 10);
      best = i;
    }
  }
  return best;
}

static void gs1_party(void) {
  int valid[GS1_SECTORS];
  for (int i = 0; i < GS1_SECTORS; i++) {
    const u8 *s = sGs1Flash + i * GS1_SECTOR;
    int sum = 0;
    valid[i] = 0;
    if (memcmp(s, "CAMELOT", 7) != 0 || s[7] >= 16)
      continue;
    for (int k = 0; k < 4072; k++)
      sum += s[16 + k];
    if ((u16)sum != rd16(s + 8))
      continue;
    valid[i] = 1;
    /* an interrupted replacement can leave two copies: the higher counter stays, the earlier on a tie */
    for (int j = 0; j < i; j++)
      if (valid[j] && sGs1Flash[j * GS1_SECTOR + 7] == s[7]) {
        if (rd16(sGs1Flash + j * GS1_SECTOR + 10) < rd16(s + 10))
          valid[j] = 0;
        else
          valid[i] = 0;
      }
  }
  int chosen = -1;
  u32 best = 0;
  for (int f = 0; f < 3; f++) {
    int at = gs1_part(valid, f);
    if (at < 0)
      continue;
    const u8 *sum = sGs1Flash + at * GS1_SECTOR;
    if (sum[0x1c] && sum[0x31] && (chosen < 0 || rd32(sum + 0x20) > best)) {
      chosen = f;
      best = rd32(sum + 0x20);
    }
  }
  if (chosen < 0)
    return;
  int a = gs1_part(valid, chosen), b = gs1_part(valid, chosen + 3);
  if (b < 0)
    return;
  memset(sParty, 0, sizeof(sParty));
  memcpy(sParty, sGs1Flash + a * GS1_SECTOR + 16, GS1_PAYLOAD);
  memcpy(sParty + GS1_SECTOR, sGs1Flash + b * GS1_SECTOR + 16, GS1_SEND - GS1_SECTOR);
  sPartyLen = GS1_SEND;
  sPartyFile = chosen;
  sPartyLevel = sGs1Flash[a * GS1_SECTOR + 0x1c];
}

/* at rtw_start, before the game runs */
static void party_start(void) {
  if (sGs1Given)
    gs1_party();
  Port_TlaAutoTransferArm(sPartyLen ? 1 : 0);
}

/* rtw_glue.js: the bytes GS1 would send (0 = none), and what was chosen (0 file, 1 level, 2 given a GS1 save) */
RTW int port_rtw_party(void) { return sPartyLen ? (int)(uintptr_t)sParty : 0; }
RTW int port_rtw_party_info(int i) { return i == 0 ? sPartyFile : i == 1 ? sPartyLevel : sGs1Given; }
