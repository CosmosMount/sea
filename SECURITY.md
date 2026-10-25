# Security and privacy

SEA is a trusted Host plugin, not a hostile-document isolation sandbox. Only install it from a reviewed source. It performs local course persistence under the current workspace, checks the current session write mode before mutation, rejects remote filesystem fallbacks, confines local imports to the workspace, and rejects symlink/hardlink state targets. It never asks to elevate the session, runs no shell commands, executes no uploaded scripts and defines no unauthenticated HTTP endpoints.

## Threat model and limits

- Uploaded course text is untrusted data. The authoring protocol explicitly rejects embedded instructions, but prompt injection cannot be eliminated by a prompt. Inspect the agent's proposed actions and retain Harness approval controls.
- PDF and ZIP/XML parsers run in the Host process. Input/output size limits, ZIP entry preflight and extraction ceilings reduce denial-of-service risk but are not complete parser isolation. Do not process untrusted internet archives as an administrator. Keep dependencies and Harness patched.
- Portable filesystem checks reject known symlink/hardlink escapes; they cannot defeat a malicious same-user process swapping directories concurrently between validation and writes. Do not use a workspace writable by untrusted local users/processes.
- State writes use exclusive course locks and revision checks. A crashed writer can leave `.lock`. After confirming **no live writer** uses that course, back up its state and remove only that exact course lock manually. Do not blindly delete locks or auto-expire them while another process may be working.
- An export directory without `manifest.json` is incomplete. Retain the prior complete edition. Manual cleanup must target only the verified incomplete directory.
- Existing question IDs cannot disappear. Changing their prompts or assessment metadata requires a recorded substantive correction reason. Content corrections are still possible; the model must preserve givens unless that is the intended correction and explain the change. A structural validator does not prove truthful review, correct mathematics, or copyright clearance.
- User-provided block content is literal text/structured math/relations, not HTML. Arbitrary external images, raw SVG, URLs and shell snippets are not renderer capabilities. TeX extensions that enable arbitrary HTML/loading are disabled.

## Data handling

The `.sea` directory contains full extracted course text and authored content. Harness retains uploaded attachment objects and session logs independently. Neither disabling the plugin nor deleting `.sea` purges Harness attachments/logs. Consult Harness retention controls separately. Content read by the agent goes to the selected model/provider; SEA does not add another AI service or telemetry channel.

Do not commit `.sea`, `examples`, `.analysis`, `.env` or secrets. npm uses an explicit allowlist. Validate the actual archive before release. Do not submit private course content or credentials in an issue.

## Reporting

Report vulnerabilities privately through the hosting platform's private security advisory feature when available. If no private channel exists, open a minimal issue requesting one without exploit details, private data or credentials. The repository currently offers no response-time or support-lifetime guarantee. For a suspected live compromise, disable the plugin, preserve sanitized evidence, and rotate exposed credentials through their original provider.
