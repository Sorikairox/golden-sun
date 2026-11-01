/* The few symbols clang's blocks need (the nested functions of seven vendor files became blocks,
 * tools/wasm/port_src.py). The game's blocks live on the stack and are never copied, so the copy helpers
 * are never called; they exist to satisfy the references clang emits. */
void *_NSConcreteStackBlock[32];
void *_NSConcreteGlobalBlock[32];

void _Block_object_assign(void *destination, const void *object, const int flags) {
  (void)flags;
  *(const void **)destination = object;
}

void _Block_object_dispose(const void *object, const int flags) {
  (void)object;
  (void)flags;
}
