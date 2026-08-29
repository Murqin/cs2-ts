// The script side of the type stripper. Bundled together with ts-blank-space and the
// TypeScript parser into one file, which the host evaluates into a dedicated engine.
//
// Everything crosses the host boundary as a single JSON string. Handing back an object
// graph would make the host pay a marshalling round trip per diagnostic field, and the
// result would still have to be copied before the next call reuses the engine.

import { blankSourceFile } from "ts-blank-space";
import ts from "typescript";

// ts-blank-space parses with these options internally. blankSourceFile is used instead
// of the default export so that the SourceFile stays reachable here: parse diagnostics
// live on it, and positions cannot be turned into line/column without it.
const PARSE_OPTIONS = {
    languageVersion: ts.ScriptTarget.ESNext,
    impliedNodeFormat: ts.ModuleKind.ESNext,
    jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
};

const SK = ts.SyntaxKind;

const PARAMETER_MODIFIERS = new Set([
    SK.PrivateKeyword,
    SK.ProtectedKeyword,
    SK.PublicKeyword,
    SK.ReadonlyKeyword,
    SK.OverrideKeyword,
]);

/**
 * ts-blank-space reports a node it cannot erase; this turns that node into a message
 * that names the construct and the replacement. The generic "this syntax is not
 * erasable" is true but useless to someone who just wants their plugin to load.
 */
function describe(node) {
    if (PARAMETER_MODIFIERS.has(node.kind)) {
        return {
            code: "CS2TS_PARAMETER_PROPERTY",
            message:
                "Parameter properties are not erasable. Declare the field on the class " +
                "and assign it in the constructor body.",
        };
    }

    switch (node.kind) {
        case SK.EnumDeclaration:
            return {
                code: "CS2TS_ENUM",
                message:
                    "'enum' is not erasable. Use a const object instead: " +
                    "const Team = { T: 2, CT: 3 } as const; " +
                    "type Team = (typeof Team)[keyof typeof Team];",
            };
        case SK.ModuleDeclaration:
            return {
                code: "CS2TS_NAMESPACE",
                message:
                    "'namespace' with runtime values is not erasable. Use a module — " +
                    "a separate file with exports — instead.",
            };
        case SK.ImportEqualsDeclaration:
            return {
                code: "CS2TS_IMPORT_EQUALS",
                message: "'import x = ...' is not erasable. Use an ES import instead.",
            };
        case SK.ExportAssignment:
            return {
                code: "CS2TS_EXPORT_EQUALS",
                message: "'export =' is not erasable. Use 'export default' instead.",
            };
        case SK.TypeAssertionExpression:
            return {
                code: "CS2TS_LEGACY_CAST",
                message: "The '<T>value' cast is not erasable. Use 'value as T' instead.",
            };
        default:
            // The remaining case is an 'as' or 'satisfies' whose erasure would regroup
            // the surrounding ?? / && / || operators into different code.
            return {
                code: "CS2TS_ASSERTION_GROUPING",
                message:
                    "Erasing this assertion would change how the surrounding '??', '&&' " +
                    "and '||' operators group. Parenthesise the operand.",
            };
    }
}

/**
 * Decorators fall through every other guard: the shipped tsconfig's erasableSyntaxOnly
 * does not flag them (they are proposed JavaScript syntax, not a TypeScript extension),
 * and ts-blank-space copies them through untouched. V8 then rejects the output with
 * "Invalid or unexpected token", which points at a construct the author was told is
 * supported. Reporting them here keeps the promise the tsconfig makes.
 */
function collectDecorators(sourceFile, report) {
    const walk = (node) => {
        if (ts.canHaveDecorators(node)) {
            const decorators = ts.getDecorators(node);
            if (decorators) {
                for (const decorator of decorators) {
                    report(decorator, {
                        code: "CS2TS_DECORATOR",
                        message:
                            "Decorators are not supported: they need a runtime the type " +
                            "stripper does not provide. Call the function directly instead.",
                    });
                }
            }
        }
        ts.forEachChild(node, walk);
    };

    ts.forEachChild(sourceFile, walk);
}

/**
 * Top-level await falls through every guard the way decorators do, and the failure it
 * causes is quieter than theirs.
 *
 * The shipped tsconfig cannot refuse it — it is ordinary module syntax — and
 * ts-blank-space copies it through untouched. What happens then was measured against
 * ClearScript rather than assumed: the host's Execute **returns immediately**, having
 * run the module only as far as the first await. Everything after it is left undone,
 * nothing is thrown, and nothing is logged. A rejected await is swallowed entirely.
 *
 * So a plugin whose top level awaits anything half-loads in silence: some handlers are
 * registered and some are not, and the author sees a plugin that "sometimes works".
 *
 * There is also nothing worth awaiting up there. The top level runs on the game thread
 * while the server waits, and the way back from work that takes time is
 * `server.nextFrame`.
 */
function collectTopLevelAwait(sourceFile, report) {
    const described = {
        code: "CS2TS_TOP_LEVEL_AWAIT",
        message:
            "'await' at the top level of a plugin is not supported: the plugin would " +
            "load only as far as this line, with nothing reported. Do the work inside " +
            "a handler, and come back to the game thread with server.nextFrame.",
    };

    // Descends through everything except the bodies that introduce their own await
    // context: inside a function, `await` is that function's business and runs when it
    // is called rather than while the plugin is loading.
    const walk = (node) => {
        if (
            ts.isFunctionDeclaration(node) ||
            ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isGetAccessor(node) ||
            ts.isSetAccessor(node) ||
            ts.isConstructorDeclaration(node) ||
            ts.isClassStaticBlockDeclaration(node)
        ) {
            return;
        }

        if (node.kind === SK.AwaitExpression) {
            report(node, described);
        }

        // `for await (const x of y)` is the same await wearing a loop.
        if (ts.isForOfStatement(node) && node.awaitModifier) {
            report(node.awaitModifier, described);
        }

        ts.forEachChild(node, walk);
    };

    ts.forEachChild(sourceFile, walk);
}

/**
 * Picks the parser mode from the file's extension.
 *
 * This is not a formality. Parsed as TypeScript, `a < b > (c)` reads as a call with
 * type arguments, so the stripper erases `< b >` and hands back `a       (c)` — valid
 * JavaScript turned into different, silently wrong JavaScript, with no diagnostic.
 * Measured. Parsed as JavaScript the same line survives untouched.
 */
function scriptKindFor(fileName) {
    return /\.[cm]?js$/i.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function strip(fileName, source) {
    const sourceFile = ts.createSourceFile(fileName, source, PARSE_OPTIONS, false, scriptKindFor(fileName));
    const diagnostics = [];

    const report = (node, described) => {
        const start = node.getStart(sourceFile);
        const position = sourceFile.getLineAndCharacterOfPosition(start);
        diagnostics.push({
            code: described.code,
            message: described.message,
            line: position.line + 1,
            column: position.character + 1,
        });
    };

    // A file that does not parse still produces output from ts-blank-space, and that
    // output is broken in a different place than the mistake. Reading the parse
    // diagnostics first is what keeps the reported location pointing at the typo.
    for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
        const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        diagnostics.push({
            code: `TS${diagnostic.code}`,
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
            line: position.line + 1,
            column: position.character + 1,
        });
    }

    if (diagnostics.length > 0) {
        return { javaScript: null, diagnostics };
    }

    collectDecorators(sourceFile, report);
    collectTopLevelAwait(sourceFile, report);
    const javaScript = blankSourceFile(sourceFile, (node) => report(node, describe(node)));

    return diagnostics.length > 0 ? { javaScript: null, diagnostics } : { javaScript, diagnostics };
}

globalThis.__cs2ts_strip = function (fileName, source) {
    try {
        return JSON.stringify(strip(fileName, source));
    } catch (error) {
        // A throw from the parser is a bug in this layer, not in the plugin. It still
        // has to reach the host as data: an exception thrown across the boundary would
        // arrive without the file it was thrown for.
        return JSON.stringify({
            javaScript: null,
            diagnostics: [
                {
                    code: "CS2TS_STRIPPER_FAILED",
                    message: `The type stripper failed: ${(error && error.message) || error}`,
                    line: 1,
                    column: 1,
                },
            ],
        });
    }
};
