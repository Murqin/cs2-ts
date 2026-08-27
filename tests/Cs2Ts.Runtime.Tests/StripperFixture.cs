using Cs2Ts.Runtime;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// One runtime and one stripper for the whole test class, which is also how the server
/// uses them: the parser bundle is evaluated once per process, not once per plugin.
///
/// No V8Bootstrap here. Outside the CS2 server process there is no Valve libv8.so in
/// the global lookup scope, so ClearScript's own V8 is the only one and loads normally.
/// The bootstrap is what makes these same calls work inside the server.
/// </summary>
public sealed class StripperFixture : IDisposable
{
    public StripperFixture()
    {
        Runtime = new V8Runtime("cs2ts-tests");
        Stripper = TypeStripper.Create(Runtime);
    }

    public V8Runtime Runtime { get; }

    public TypeStripper Stripper { get; }

    public void Dispose()
    {
        Stripper.Dispose();
        Runtime.Dispose();
    }
}

[CollectionDefinition(Name)]
public sealed class StripperCollection : ICollectionFixture<StripperFixture>
{
    public const string Name = "stripper";
}
