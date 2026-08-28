// A tick handler that throws, in its own script on purpose.
//
// Handlers are taken out of service one at a time, but a failing handler in harness.ts
// would still leave that script's tick counter frozen for whichever test ran next —
// and xunit does not promise an order. Its own file is its own plugin.

let armed = false;

on("tick", () => {
    if (armed) {
        throw new Error("this tick handler always throws");
    }
});

command("!hfailtick", () => {
    armed = true;
    console.log("HARNESS failtick armed");
});
