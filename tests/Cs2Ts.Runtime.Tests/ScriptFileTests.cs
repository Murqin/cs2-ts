using Cs2Ts.Runtime;

namespace Cs2Ts.Runtime.Tests;

public sealed class ScriptFileTests
{
    [Theory]
    [InlineData("vip.ts")]
    [InlineData("vip.js")]
    [InlineData("/srv/scripts/vip system.ts")]
    [InlineData("VIP.TS")]
    public void ScriptsAreScripts(string path) => Assert.True(ScriptFile.IsScript(path));

    [Theory]
    [InlineData("cs2ts.d.ts")]
    [InlineData("/srv/scripts/types.d.ts")]
    [InlineData("TYPES.D.TS")]
    public void DeclarationsAreNot(string path)
    {
        // The glob that used to decide this matched *.ts, so the plugin tried to run its
        // own declaration file and failed on the first export — against a file the author
        // never wrote. It only surfaced once the declarations were shipped into the
        // author's own directory.
        Assert.True(ScriptFile.IsDeclaration(path));
        Assert.False(ScriptFile.IsScript(path));
    }

    [Theory]
    [InlineData("tsconfig.json")]
    [InlineData("notes.md")]
    [InlineData("vip.tsx")]
    [InlineData("script.ts.bak")]
    public void NothingElseIs(string path) => Assert.False(ScriptFile.IsScript(path));
}
