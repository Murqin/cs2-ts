import { FACTOR, times } from "./physics.ts";

// Module scope, not global. harness.ts has a `ticks` of its own and neither the
// compiler nor the runtime minds.
const ticks = "module-scoped";

command("!hmodule", () => {
    console.log(`HARNESS module factor=${FACTOR} times=${times(6)} scope=${ticks}`);
});
