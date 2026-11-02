# AGENTS.md

Repository-wide instructions for AI coding agents working on
**boost-html**.

## 1. Project Mission

`boost-html` is a lightweight, production-oriented browser navigation
library for multi-page HTML applications.

Its goals are:

-   **Performance-first:** minimize navigation overhead, runtime work,
    memory use, and bundle size.
-   **Lightweight:** keep the core free of mandatory runtime
    dependencies.
-   **Framework-agnostic:** work with plain HTML and native browser
    APIs; do not require React, Vue, Alpine, or another framework.
-   **Progressive enhancement:** intercepted navigation must preserve
    ordinary browser navigation as a reliable fallback.
-   **Production quality:** prioritize correctness, security,
    compatibility, accessibility, and maintainability over feature
    count.

The library is inspired by boosted navigation patterns, but it must
retain its own focused scope. Do not turn it into a general-purpose
routing framework or a full HTMX replacement.

## 2. Non-Negotiable Engineering Principles

1.  **Inspect before changing.** Read the relevant source, tests,
    package scripts, and documentation before editing.
2.  **Measure before optimizing.** Do not claim a performance
    improvement without reproducible benchmark results.
3.  **Correctness before speed.** Never weaken navigation correctness,
    security, or fallback behavior to improve a benchmark.
4.  **Native APIs first.** Prefer Fetch, AbortController, URL,
    DOMParser, History API, and standard DOM events.
5.  **No unnecessary dependencies.** Do not add a runtime dependency
    without explaining why a native implementation or optional adapter
    is insufficient.
6.  **Keep optional features optional.** Prefetching, caching, morphing,
    and progress UI must not impose meaningful runtime or bundle cost
    when disabled.
7.  **Preserve public API compatibility.** Do not rename, remove, or
    change the semantics of documented public APIs without explicit
    approval.
8.  **Avoid speculative abstractions.** Build only what current
    requirements and real use cases justify.
9.  **Document observable behavior.** Update README/API documentation
    when public behavior, configuration, events, or limitations change.
10. **Do not overstate guarantees.** Distinguish tested behavior from
    assumptions and targets.

## 3. Required Workflow

For each task:

1.  Inspect the relevant implementation and existing conventions.
2.  Identify affected modules, public APIs, and compatibility
    implications.
3.  State a short implementation plan when the task spans multiple
    modules or changes public behavior.
4.  Make the smallest coherent change that solves the task.
5.  Add or update tests alongside the implementation.
6.  Run the relevant checks:
    -   formatting and linting, if configured;
    -   TypeScript typecheck;
    -   relevant unit and integration tests;
    -   browser tests when navigation, DOM, history, or browser behavior
        changes;
    -   production build.
7.  Review the final diff for unrelated changes, unsafe behavior, dead
    code, and accidental API changes.
8.  Report exactly what changed, which commands were run, their results,
    and any remaining risks.

Do not proceed to another roadmap phase automatically. Finish the
requested task and report its status.

If a command cannot be run, say why. Never report a check as passing
unless it was actually executed successfully.

## 4. Architecture Boundaries

Use the existing repository structure where practical. The intended
logical responsibilities are:

-   **Core:** instance creation, defaults, lifecycle, and shared
    navigation state.
-   **Navigation:** link/form interception, eligibility checks, and
    navigation coordination.
-   **Request:** Fetch requests, headers, form data, cancellation, and
    timeout handling where supported.
-   **Response:** status/content-type validation, HTML parsing, and
    response document handling.
-   **DOM:** target resolution, replacement, optional morph adapter, and
    explicit script policy.
-   **History:** URL commits, push/replace state, back/forward handling,
    and restoration metadata.
-   **Scroll:** anchor behavior, scroll restoration, and focus
    management.
-   **Events:** typed lifecycle events and cancellation semantics.
-   **Progress:** optional loading/progress integration.
-   **Prefetch:** optional, conservative prefetch strategies.
-   **Cache:** optional in-memory cache and cache policy.
-   **Utilities and types:** small shared helpers and public/internal
    TypeScript types.

Keep dependencies flowing in a clear direction. Avoid circular
dependencies. Keep browser-specific functionality out of pure utility
modules where practical.

Do not create a file or abstraction merely to match this list. Follow
the existing codebase and keep the architecture proportionate.

## 5. Performance Requirements

-   Use event delegation rather than attaching listeners to every link
    or form.
-   Avoid duplicate HTML parsing and repeated DOM queries within one
    navigation.
-   Avoid unnecessary allocations and redundant state.
-   Do not force synchronous layout or style recalculation.
-   Do not run DOM morphing when the configured strategy is replacement.
-   Do not initialize optional subsystems unless enabled or needed.
-   Keep the default path simple and fast.
-   Ensure `start()` is idempotent and `stop()` releases listeners,
    observers, and active work.
-   Prevent stale responses from committing after a newer navigation has
    taken ownership.
-   Avoid unbounded caches, queues, observers, and concurrency.
-   Benchmark representative small, medium, and large documents.
-   Report median and p95 where useful, plus test environment and
    fixture details.

The initial target of a core bundle at or below **5 KB minified + gzip**
is an optimization goal, not permission to remove required functionality
or misrepresent measured size. Report actual bundle size and how it was
measured.

## 6. Navigation and Request Correctness

-   Intercept only eligible same-origin navigations.
-   Preserve native browser behavior for external links, downloads,
    non-self targets, modifier-key clicks, unsupported methods, and
    explicitly opted-out elements.
-   Preserve normal navigation when interception fails or a response
    cannot safely be processed.
-   Use `AbortController` for cancellation where supported.
-   Ensure only the current navigation can commit its response.
-   Keep URL/history state consistent with the content actually
    displayed.
-   Validate response status and content type before DOM replacement.
-   Handle redirects deliberately and validate the final URL against the
    library's origin policy.
-   Preserve form semantics, including GET query encoding, POST
    `FormData`, file inputs, and submitter name/value.
-   Do not automatically retry a non-idempotent form submission.
-   Prevent accidental duplicate form submissions without blocking
    legitimate user behavior.
-   Treat hash-only navigation and browser back/forward as explicit
    cases.

## 7. DOM and Script Security

Security is a core requirement, not a later enhancement.

-   Treat fetched HTML as untrusted input until it has passed the
    library's validation and policy checks.
-   `DOMParser` parsing is not HTML sanitization.
-   Do not execute scripts from fetched documents by default.
-   Do not use `eval()` or `Function()`.
-   Do not automatically execute inline scripts, external scripts, or
    inline event handlers.
-   Do not describe `innerHTML`, DOMParser, or DOM replacement as
    sanitization.
-   Keep any explicitly supported script-handling mechanism opt-in,
    narrowly scoped, and documented with its risks.
-   Consider CSP nonce and Trusted Types compatibility where relevant;
    never bypass the host application's security policy.
-   Validate URLs and same-origin boundaries, including redirect
    destinations.
-   Ensure cache entries cannot leak authenticated or user-specific
    content across sessions.
-   Avoid unsafe selectors, DOM clobbering assumptions, and trusting
    response-provided metadata without validation.
-   Add regression tests for security-sensitive behavior.

If a requested feature conflicts with these rules, explain the risk and
propose a safer alternative before implementing it.

## 8. History, Scroll, and Accessibility

-   Preserve browser back/forward behavior.
-   Avoid duplicate or premature history commits.
-   Keep URL and rendered content consistent if parsing or swapping
    fails.
-   Restore scroll positions for history traversal when configured.
-   Respect hash anchors.
-   Do not steal focus unnecessarily.
-   Provide accessible loading and navigation announcements where
    appropriate.
-   Restore browser settings changed by the library when `stop()` is
    called.
-   Ensure focus and scroll features can be disabled or configured.

## 9. Optional Prefetch and Cache

These features must be conservative and disabled by default unless the
current public API explicitly specifies otherwise.

### Prefetch

-   Prefetch GET navigations only.
-   Restrict to eligible same-origin URLs.
-   Exclude forms, destructive actions, and links explicitly opted out.
-   Respect user/network constraints where detectable.
-   Bound concurrency and deduplicate in-flight work.
-   Ensure prefetch never changes application state and never interferes
    with actual navigation.
-   Do not prefetch sensitive routes by default.

### Cache

-   Use a bounded cache with explicit eviction.
-   Cache GET responses only.
-   Respect `Cache-Control`, including `no-store`, and relevant `Vary`
    semantics.
-   Treat authenticated and personalized responses conservatively.
-   Define invalidation behavior after state-changing requests.
-   Never assume cached HTML remains valid indefinitely.
-   Make cache behavior observable and testable.

## 10. TypeScript and Public API

-   Keep TypeScript strict; do not introduce `any` to avoid designing a
    correct type.
-   Prefer explicit public types for configuration, navigation results,
    and lifecycle event details.
-   Keep internal types separate from exported public types.
-   Validate runtime configuration where invalid values could cause
    incorrect behavior.
-   Preserve documented defaults and semantics.
-   Avoid exposing internal implementation details as public API.
-   Do not add a public option or method without documenting its
    purpose, default, and behavior.
-   Treat changes to public API as compatibility decisions, not
    incidental refactors.

## 11. Testing Standards

Add tests for behavior, not implementation details.

At minimum, cover relevant cases from these groups:

### Core lifecycle

-   repeated `start()`;
-   repeated `stop()`;
-   start after stop;
-   listener and observer cleanup;
-   active request cancellation.

### Navigation

-   same-origin link;
-   external link;
-   opt-out attribute;
-   modifier-key and non-primary clicks;
-   hash-only navigation;
-   concurrent navigation and stale response prevention;
-   redirects and failed requests.

### Forms

-   GET;
-   POST;
-   file upload;
-   submitter values;
-   duplicate submission protection;
-   native fallback.

### Response and DOM

-   valid HTML;
-   invalid content type;
-   HTTP errors;
-   malformed or incomplete documents;
-   missing target;
-   replacement behavior;
-   optional morph behavior;
-   script execution disabled by default.

### History and accessibility

-   push and replace state;
-   back/forward;
-   scroll restoration;
-   anchor navigation;
-   focus behavior;
-   cleanup of modified browser state.

### Optional features

-   prefetch eligibility and cancellation;
-   concurrency limits;
-   cache eviction and invalidation;
-   cache policy and authenticated response isolation.

Use unit tests for isolated logic, integration tests for subsystem
interactions, and Playwright or equivalent real-browser tests for
browser APIs and navigation behavior. Do not rely on jsdom alone for
browser-history, layout, or real navigation guarantees.

## 12. Build, Package, and Compatibility

-   Keep the package ESM-first unless repository requirements justify
    additional formats.
-   Ensure package exports and TypeScript declarations match actual
    generated files.
-   Keep the browser bundle and CDN entry point intentional and
    documented.
-   Verify the contents of the published package with
    `npm pack --dry-run`.
-   Do not publish to npm or create a release unless explicitly
    instructed.
-   Do not change package version as part of unrelated implementation
    work.
-   Test supported browsers using the configured browser matrix.
-   Document unsupported environments and required browser APIs.
-   Avoid claiming universal browser compatibility without evidence.

## 13. Dependencies and Tooling

Before adding a dependency:

1.  Check whether the platform already provides the required capability.
2.  Check bundle impact and whether the dependency can be optional.
3.  Check maintenance status, license, security posture, and browser
    compatibility.
4.  Explain the trade-off in the implementation summary.

Do not replace the existing toolchain merely because another tool is
fashionable. Follow repository scripts and conventions unless there is a
concrete technical reason to change them.

## 14. Documentation and Change Management

When behavior changes, update the relevant documentation in the same
task.

Document: - public API and configuration; - defaults; - lifecycle event
names and payloads; - fallback behavior; - browser support; - security
implications; - known limitations; - migration steps for breaking
changes.

Do not silently change a default that affects existing users. If a
security improvement requires a breaking change, explain the
compatibility impact and propose a major-version migration.

Keep changes focused. Do not reformat or rewrite unrelated files.

## 15. Definition of Done

A task is complete only when:

-   the requested behavior is implemented;
-   relevant tests are added or updated;
-   typecheck and relevant tests pass, or failures are clearly reported;
-   the production build succeeds, or the blocker is clearly reported;
-   documentation is updated when public behavior changes;
-   no known security regression is introduced;
-   no unrelated changes remain;
-   the final report lists changed files, commands executed, results,
    and remaining limitations.

## 16. Agent Response Format

At the end of each task, report:

1.  **Summary:** what was implemented.
2.  **Files changed:** concise list with purpose.
3.  **Tests and checks:** exact commands and pass/fail status.
4.  **Performance impact:** measured results, or state that no benchmark
    was run.
5.  **Security and compatibility:** relevant considerations.
6.  **Remaining work:** known limitations or follow-up tasks.

Never claim that work, tests, benchmarks, audits, or releases were
completed unless they were actually performed.
