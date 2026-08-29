using System.Text;
using CounterStrikeSharp.API.Core;
using Cs2Ts.DataGen;

// Writes the wide entity surfaces, in both languages, from CounterStrikeSharp's own
// classes. Run it after bumping CounterStrikeSharp; --check is the same work with the
// files compared rather than written, which is what the test uses to catch a bump that
// forgot to.
var check = args.Contains("--check", StringComparer.Ordinal);
var root = Repository.Root();

var surfaces = Surfaces.All();

var events = Events.Read(typeof(CCSPlayerPawn).Assembly);

var files = new Dictionary<string, string>(StringComparer.Ordinal);

foreach (var surface in surfaces)
{
    files[Path.Combine("src", "Cs2Ts.Plugin", "Generated", $"{surface.Name}.g.cs")] = Emit.CSharp(surface);
}

files[Path.Combine("src", "Cs2Ts.Plugin", "Generated", "GameEvents.g.cs")] = Emit.CSharpEvents(events);

var declarations = Path.Combine("templates", "cs2ts.d.ts");
files[declarations] = Region.Replace(
    File.ReadAllText(Path.Combine(root, declarations)),
    string.Join("\n", [.. surfaces.Select(Emit.TypeScript), Emit.TypeScriptEvents(events)]));

var stale = new List<string>();

foreach (var (relative, content) in files)
{
    var path = Path.Combine(root, relative);
    var existing = File.Exists(path) ? File.ReadAllText(path) : null;

    if (string.Equals(existing, content, StringComparison.Ordinal))
    {
        continue;
    }

    stale.Add(relative);

    if (!check)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }
}

foreach (var surface in surfaces)
{
    var left = surface.Skipped.OrderByDescending(kind => kind.Value)
        .Select(kind => $"{kind.Value} {kind.Key}");

    Console.WriteLine(
        $"{surface.Name}: {surface.Fields.Count} fields, not yet carried: {string.Join(", ", left)}");
}

var eventFields = events.Sum(surface => surface.Fields.Count);
var eventSkipped = events.SelectMany(surface => surface.Skipped)
    .GroupBy(kind => kind.Key, StringComparer.Ordinal)
    .Select(kind => $"{kind.Sum(entry => entry.Value)} {kind.Key}");

Console.WriteLine(
    $"events: {events.Count} events, {eventFields} fields, not carried: {string.Join(", ", eventSkipped)}");

if (stale.Count == 0)
{
    Console.WriteLine("up to date");
    return 0;
}

Console.WriteLine($"{(check ? "stale" : "written")}: {string.Join(", ", stale)}");
return check ? 1 : 0;

/// <summary>Where the repository is, found rather than configured.</summary>
internal static class Repository
{
    public static string Root()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Cs2Ts.slnx")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName
            ?? throw new InvalidOperationException("no Cs2Ts.slnx above this tool; run it inside the repository");
    }
}

/// <summary>
/// The part of the shipped declaration file this tool owns.
///
/// One file rather than two, because it is shipped to an author's scripts folder and
/// named by the tsconfig next to it: a second file would be a second thing to install
/// and a second way for an install to be half done. The prose around the region stays
/// hand-written — the generator only knows the fields.
/// </summary>
internal static class Region
{
    private const string Begin = "    // BEGIN GENERATED";
    private const string End = "    // END GENERATED";

    public static string Replace(string file, string body)
    {
        var start = file.IndexOf(Begin, StringComparison.Ordinal);
        var end = file.IndexOf(End, StringComparison.Ordinal);

        if (start < 0 || end < start)
        {
            throw new InvalidOperationException(
                $"the declaration file has no region between '{Begin}' and '{End}' to write into");
        }

        var header = file[start..file.IndexOf('\n', start)];
        var text = new StringBuilder();
        text.Append(file[..start]);
        text.Append(header).Append('\n');
        text.Append(body.TrimEnd('\n')).Append('\n');
        text.Append(file[end..]);
        return text.ToString();
    }
}
