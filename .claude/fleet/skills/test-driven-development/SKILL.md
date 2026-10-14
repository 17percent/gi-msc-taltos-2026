---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## When to Use

**Always:**
- New features
- Bug fixes
- Refactoring
- Behavior changes

**Exceptions (ask your human partner):**
- Throwaway prototypes
- Generated code
- Configuration files

Thinking "skip TDD just this once"? Stop. That's rationalization.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

Implement fresh from tests. Period.

## Red-Green-Refactor

```dot
digraph tdd_cycle {
    rankdir=LR;
    red [label="RED\nWrite failing test", shape=box, style=filled, fillcolor="#ffcccc"];
    verify_red [label="Verify fails\ncorrectly", shape=diamond];
    green [label="GREEN\nMinimal code", shape=box, style=filled, fillcolor="#ccffcc"];
    verify_green [label="Verify passes\nAll green", shape=diamond];
    refactor [label="REFACTOR\nClean up", shape=box, style=filled, fillcolor="#ccccff"];
    next [label="Next", shape=ellipse];

    red -> verify_red;
    verify_red -> green [label="yes"];
    verify_red -> red [label="wrong\nfailure"];
    green -> verify_green;
    verify_green -> refactor [label="yes"];
    verify_green -> green [label="no"];
    refactor -> verify_green [label="stay\ngreen"];
    verify_green -> next;
    next -> red;
}
```

### RED - Write Failing Test

Write one minimal test showing what should happen.

<Good>
```csharp
[Fact]
public async Task RunAsync_RetriesFailedOperationThreeTimes()
{
    var attempts = 0;
    Task<string> Operation()
    {
        attempts++;
        if (attempts < 3) throw new InvalidOperationException("fail");
        return Task.FromResult("success");
    }

    var result = await Retry.RunAsync(Operation);

    Assert.Equal("success", result);
    Assert.Equal(3, attempts);
}
```
Clear name, tests real behavior, one thing
</Good>

<Bad>
```csharp
[Fact]
public async Task RetryWorks()
{
    var op = Substitute.For<Func<Task<string>>>();
    op.Invoke().Returns(Task.FromException<string>(new Exception()),
                        Task.FromException<string>(new Exception()),
                        Task.FromResult("success"));
    await Retry.RunAsync(op);
    await op.Received(3).Invoke();
}
```
Vague name, tests mock not code
</Bad>

**Requirements:**
- One behavior
- Clear name
- Real code (no mocks unless unavoidable)

### Verify RED - Watch It Fail

**MANDATORY. Never skip.**

```bash
dotnet test --filter "FullyQualifiedName~RunAsync_RetriesFailedOperationThreeTimes"
```

Confirm:
- Test fails (not errors)
- Failure message is expected
- Fails because feature missing (not typos)

**Compile error is not RED.** In C#/C++ a missing method fails the build, not the test. First add the smallest signature stub that compiles (`throw new NotImplementedException();`), then run: now the test fails for the right reason.

**Test passes?** You're testing existing behavior. Fix test.

**Test errors?** Fix error, re-run until it fails correctly.

### GREEN - Minimal Code

Write simplest code to pass the test.

<Good>
```csharp
public static async Task<T> RunAsync<T>(Func<Task<T>> fn)
{
    for (var i = 0; ; i++)
    {
        try { return await fn(); }
        catch when (i < 2) { }   // third failure propagates
    }
}
```
Just enough to pass
</Good>

<Bad>
```csharp
public static async Task<T> RunAsync<T>(
    Func<Task<T>> fn,
    RetryOptions? options = null,           // maxRetries, backoff, onRetry...
    CancellationToken ct = default)
{
    // YAGNI
}
```
Over-engineered
</Bad>

Don't add features, refactor other code, or "improve" beyond the test.

### Verify GREEN - Watch It Pass

**MANDATORY.**

```bash
dotnet test --filter "FullyQualifiedName~RunAsync_RetriesFailedOperationThreeTimes"
```

Confirm:
- Test passes
- Other tests still pass
- Output pristine (no errors, warnings)

**Test fails?** Fix code, not test.

**Other tests fail?** Fix now.

**"Other tests" means the project's suite, not just your file.** A
green run of the test you wrote is not a green suite. Before you call
the change done, run the project's test command (`dotnet test` on the
solution, `ctest` for C++, bare `pytest`, `npm test` — whatever the repo uses) even when your task
named only one test file. A scope statement in your task bounds the
deliverable, not your verification. Any failure that run shows —
including one you didn't cause — goes in your report by name; a red
test you watched scroll past and didn't mention is a report falsified
by omission.

### REFACTOR - Clean Up

After green only:
- Remove duplication
- Improve names
- Extract helpers

Keep tests green. Don't add behavior.

### Repeat

Next failing test for next feature.

## Stack notes: .NET / Blazor / C++ / MS SQL (this fleet's default)

Use the repo's own runner and conventions; these are the defaults when the repo does not say otherwise.

| Area | How |
|---|---|
| C# unit/integration | `dotnet test` (xUnit/NUnit/MSTest, whichever the repo uses); one test: `--filter "FullyQualifiedName~Name"`; whole solution before you call it done. Async tests are `async Task` (never `async void`, never `.Result`); time via `TimeProvider`/fake clock, not `DateTime.Now`. |
| ASP.NET Core API | `WebApplicationFactory<T>` for the HTTP contract; the data layer behind an in-process fake. |
| Blazor components (incl. Telerik) | bUnit: render the component, assert on markup and user-visible behavior (role/text), not on internals. Register the Telerik services (`AddTelerikBlazor()`), set JS interop to loose mode (`JSInterop.Mode = JSRuntimeMode.Loose`), and render inside `TelerikRootComponent` when popups are involved (they throw without it). Telerik relies on JS interop, so some behavior cannot be unit-tested in bUnit: cover that with a browser e2e test and say so. Test our logic and bindings, not that Telerik's grid sorts. |
| C++ | GoogleTest/Catch2 through CTest: `ctest --test-dir build -R Name --output-on-failure`; for the C#/C++ boundary add a test on the P/Invoke or C-API layer (ownership, encoding, error return). |
| ERP / ForSharp interfaces | Fake or stub the ERP behind the interface; inject faults (timeout, 5xx, duplicate message, bad payload). Never a live ERP. |
| **Databases: read-only** | Fleet rule: you never write to a reachable database, so tests that insert, migrate or seed run NOWHERE you can reach. Test data-access logic against an in-process fake. A test that needs a real SQL Server write is still WRITTEN (it is the spec) but NOT run: report it as "not run, needs owner approval/disposable DB", never as green. T-SQL has no red-green here: its evidence is the read-only plan/`STATISTICS IO` and a reviewable proposal script. |

The Iron Law stays for everything that can run. Where it cannot (database writes, live ERP), say so explicitly in the result under what you could NOT verify.

<!-- project-overlay:project-taltos -->
## Stack notes: Táltos (this project)

The .NET table above does not apply here. The product stack is TypeScript: the test runner is fixed by WP0, so use the repo's `package.json` scripts once they exist and never invent a command before that. Fastify: test the HTTP contract in-process (`app.inject()`). Database-writing integration tests are written but not run (the owner runs them). React: assert on user-visible behaviour. The vanilla JS prototype has no test runner: verify in the browser (clean console, both themes) or with an out-of-repo Node + jsdom harness.
<!-- /project-overlay:project-taltos -->

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing. "and" in name? Split it. | `Validates_email_and_domain_and_whitespace` |
| **Clear** | Name describes behavior | `Test1` |
| **Shows intent** | Demonstrates desired API | Obscures what code should do |

When writing or changing any test, read [writing-good-tests.md](writing-good-tests.md) for the rules that keep tests honest:
- Name the production change that would make the test fail — before writing it
- Assert on real behavior, never on mock behavior
- Keep test-only code in test utilities, out of production classes
- Understand a dependency's side effects before mocking it

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests written after pass immediately — which proves nothing. They may test the wrong thing, test the implementation instead of the behavior, or miss the edge case you forgot. You never watched it fail, so you never proved it can catch the bug. Test-first forces that failure. |
| "Tests after achieve same goals (spirit not ritual)" | Tests-after answer "what does this do?"; tests-first answer "what should this do?" Tests written after are biased by the code you already wrote — you verify the cases you remembered, not the ones you'd have discovered. Coverage without proof the tests work. |
| "Already manually tested" | Manual testing is ad-hoc: no record of what you covered, no way to re-run it when the code changes, easy to forget cases under pressure. "Worked when I tried it" ≠ comprehensive. Automated tests run the same way every time. |
| "Deleting X hours is wasteful" | Sunk cost fallacy — that time is already spent either way. The real choice: rewrite with TDD (high confidence) vs. keep it and bolt tests on after (low confidence, likely bugs). Keeping code you can't trust is the waste. |
| "Keep as reference, write tests first" | You'll adapt it. That's testing after. Delete means delete. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |
| "Test hard = design unclear" | Listen to test. Hard to test = hard to use. |
| "TDD will slow me down" | TDD IS the pragmatic path: catches bugs before commit, prevents regressions, lets you refactor without fear. "Pragmatic" shortcuts mean debugging in production — slower, not faster. |
| "Manual test faster" | Manual doesn't prove edge cases. You'll re-test every change. |
| "Existing code has no tests" | You're improving it. Add tests for existing code. |

## Red Flags - STOP and Start Over

- Code before test
- Test after implementation
- Test passes immediately
- Can't explain why test failed
- Tests added "later"
- Rationalizing "just this once"
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about spirit not ritual"
- "Keep as reference" or "adapt existing code"
- "Already spent X hours, deleting is wasteful"
- "TDD is dogmatic, I'm being pragmatic"
- "This is different because..."

**All of these mean: Delete code. Start over with TDD.**

## Example: Bug Fix

**Bug:** Empty email accepted

**RED**
```csharp
[Fact]
public void Submit_RejectsEmptyEmail()
{
    var result = FormService.Submit(new FormData(Email: ""));
    Assert.Equal("Email required", result.Error);
}
```

**Verify RED**
```bash
$ dotnet test --filter "FullyQualifiedName~Submit_RejectsEmptyEmail"
Failed Submit_RejectsEmptyEmail: Assert.Equal() Failure. Expected: Email required, Actual: (null)
```

**GREEN**
```csharp
public static SubmitResult Submit(FormData data)
{
    if (string.IsNullOrWhiteSpace(data.Email))
        return new SubmitResult(Error: "Email required");
    // ...
}
```

**Verify GREEN**
```bash
$ dotnet test
Passed! - Failed: 0, Passed: 42, Skipped: 0
```

**REFACTOR**
Extract validation for multiple fields if needed.

## Verification Checklist

Before marking work complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass
- [ ] Output pristine (no errors, warnings)
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered

Can't check all boxes? You skipped TDD. Start over.

## When Stuck

| Problem | Solution |
|---------|----------|
| Don't know how to test | Write wished-for API. Write assertion first. Ask your human partner. |
| Test too complicated | Design too complicated. Simplify interface. |
| Must mock everything | Code too coupled. Use dependency injection. |
| Test setup huge | Extract helpers. Still complex? Simplify design. |

## Debugging Integration

Bug found? Write failing test reproducing it. Follow TDD cycle. Test proves fix and prevents regression.

Never fix bugs without a test.

## Final Rule

```
Production code → test exists and failed first
Otherwise → not TDD
```

No exceptions without your human partner's permission.
