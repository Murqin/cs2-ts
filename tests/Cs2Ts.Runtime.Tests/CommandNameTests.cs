using Cs2Ts.Runtime;

namespace Cs2Ts.Runtime.Tests;

public sealed class CommandNameTests
{
    [Theory]
    [InlineData("heal", "heal")]
    [InlineData("!heal", "heal")]
    [InlineData("/heal", "heal")]
    [InlineData(".heal", "heal")]
    [InlineData("  !Heal  ", "heal")]
    [InlineData("give_ak47", "give_ak47")]
    [InlineData("!r8", "r8")]
    public void OneCommandHoweverItIsSpelled(string written, string expected) =>
        // Which trigger character a server uses is a server setting, so a script that
        // hard-coded one would work on one server and be inert on the next.
        Assert.Equal(expected, CommandName.Normalize(written));

    [Fact]
    public void TheConsoleNameCarriesThePrefix() =>
        // Not decoration: typing !heal makes the client run css_heal, so a command
        // registered without the prefix answers from neither chat nor console.
        Assert.Equal("css_heal", CommandName.ToConsoleCommand(CommandName.Normalize("!heal")));

    [Theory]
    [InlineData("")]
    [InlineData("!")]
    [InlineData("   ")]
    [InlineData("two words")]
    [InlineData("kick-player")]
    [InlineData("héal")]
    [InlineData("this_name_is_far_too_long_to_be_a_command_name")]
    public void ANameThatCannotBeACommandSaysSo(string written) =>
        Assert.Throws<ArgumentException>(() => CommandName.Normalize(written));

    [Fact]
    public void ThePrefixIsAddedNotWritten()
    {
        // css_css_heal is what registering "css_heal" would produce, and nobody would
        // work that out from the command not firing.
        var error = Assert.Throws<ArgumentException>(() => CommandName.Normalize("css_heal"));
        Assert.Contains("css_", error.Message);
    }

    [Theory]
    [InlineData("plugins")]
    [InlineData("admins_list")]
    [InlineData("!core_reload")]
    public void CounterStrikeSharpsOwnCommandsAreRefused(string written)
    {
        // Sharing css_plugins with the framework's admin tooling fails in a way nobody
        // would think to look for.
        var error = Assert.Throws<ArgumentException>(() => CommandName.Normalize(written));
        Assert.Contains("CounterStrikeSharp", error.Message);
    }
}
