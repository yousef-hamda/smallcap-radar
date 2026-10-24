# Local security patch

This is the MIT-licensed `braces` 3.0.3 package with a local nesting-depth guard in `lib/parse.js`.

The guard rejects brace or parenthesis nesting deeper than 100 levels before the parser can create an AST that overflows the recursive compile, expand, or stringify walkers. It addresses CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm. The upstream advisory has no patched release, so this repository carries the small guard until upstream publishes one.

The vendored source and license are retained here to keep the mitigation reproducible across `npm ci` installs. Remove this override and vendored copy when an upstream patched release is available and verified.
