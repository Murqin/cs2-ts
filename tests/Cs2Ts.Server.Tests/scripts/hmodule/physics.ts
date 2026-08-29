// A module inside a plugin folder. Nothing loads this on its own, and nothing outside
// hmodule/ can import it — which is the half of the design a fake cannot check, because
// the file has to actually be found, read and stripped inside the running server.

export const FACTOR: number = 7;

export function times(n: number): number {
    return n * FACTOR;
}
