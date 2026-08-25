# UX and Interaction Mandate

The application must become **more powerful while becoming easier to use**.

Do not solve feature growth by continuously adding buttons, menus, tabs, or controls to a global toolbar.

The desired product is not a traditional NLE with AI features bolted onto it.

It should feel like an intelligent environment that understands:

* what the user is currently working on
* what is selected
* what actions are relevant now
* what usually comes next
* what consequences an action will have
* what can safely be automated
* when the user needs explanation
* when the UI should get out of the way

The guiding principle is:

> **Put the useful action where the user needs it, when they need it, with enough context to make the decision obvious.**

## Brain-Dead Simple, Professionally Powerful

A new user should be able to produce a good video without learning the entire application.

An experienced user should still have access to deep controls, keyboard shortcuts, automation, keyframes, advanced timelines, rules, and AI tools.

Achieve both through **progressive disclosure**.

Default interactions should expose the simplest useful choice.

Advanced controls should appear when requested or when the current task makes them relevant.

Do not require users to understand internal video-editing terminology before completing common tasks.

Prefer:

**"Remove the pause"**

over:

**"Ripple delete selected temporal range"**

The underlying operation can still be `rippleDelete()`.

The interface should speak in terms of the user's intention.

---

# Context-Aware Actions

Actions should primarily live near the thing they affect.

Examples:

Selecting a silence region might reveal:

**Remove**
**Shorten**
**Keep**
**Apply to similar pauses**

Selecting a transcript sentence might reveal:

**Cut**
**Use another take**
**Make shorter**
**Create caption emphasis**
**Find similar sections**

Selecting a video clip might reveal:

**Trim**
**Speed up**
**Crop / Reframe**
**Improve audio**
**Replace**

Selecting a detected UI interaction might reveal:

**Zoom here**
**Highlight click**
**Follow cursor**
**Keep readable**

Selecting an error/debugging sequence might reveal:

**Keep debugging**
**Keep final solution only**
**Compress attempts**
**Turn into montage**

These actions should appear contextually instead of requiring the user to search a toolbar.

---

# Actions Should Explain Their Consequences

When an action has meaningful downstream effects, explain them before or while the user invokes it.

For example:

**Remove this section**

> Removes 8.4 seconds and closes the gap.
> Captions and audio remain synchronized.

**Use final take**

> Keeps the successful third attempt and removes the two earlier attempts.
> This shortens the video by 42 seconds.

**Speed up loading**

> Compresses this 31-second loading period to approximately 4 seconds.
> Speech occurring during this section will remain at normal speed.

**Delete transcript paragraph**

> Removes the corresponding audio and video.
> The following clip will move forward automatically.

The explanation should be concise and contextual, not a modal full of documentation.

---

# Guide the User to the Next Likely Action

After completing an operation, the application should understand reasonable next steps.

For example:

```text
Removed 14 long pauses.

Next:
[Review 3 uncertain cuts]
[Remove filler words]
[Improve pacing]
```

After transcription:

```text
Transcript ready.

Next:
[Clean pauses]
[Find retakes]
[Generate captions]
```

After Auto Edit:

```text
First edit complete.

12 decisions need review.

[Review them]
[Watch result]
[Continue editing]
```

After selecting a detected retake:

```text
This appears to contain three attempts.

[Keep final attempt]
[Compare takes]
[Leave unchanged]
```

Do not turn this into a rigid wizard.

The user should always be free to ignore the suggestions.

Think of these as **context-aware breadcrumbs through the editing process**.

---

# Prefer Decisions Over Settings

Users should generally be asked to make meaningful decisions rather than configure algorithms.

Instead of initially presenting:

```text
Silence Threshold: -32 dB
Minimum Clip Length: 0.37
Margin Before: 0.14
Margin After: 0.19
```

show:

```text
PAUSE CLEANUP

Natural
Balanced
Tight
```

Then offer:

**Advanced**

for the numerical controls.

Likewise:

```text
ZOOM STYLE

Subtle
Focused
Dynamic
```

rather than exposing six easing and transform parameters immediately.

Expert controls should exist without dominating the default experience.

---

# Use the Interface Itself as Documentation

Prefer small contextual explanations over separate documentation.

Examples:

Hovering or expanding **Protect**:

> Auto Edit will leave this section unchanged.

Hovering **Use Another Take**:

> Compare nearby attempts that appear to say or accomplish the same thing.

Hovering **Visual-aware cuts**:

> Silent sections are removed only when nothing important is happening on screen.

When possible, allow the user to preview the result directly instead of explaining it with text.

---

# Preview Before Commitment

For potentially disruptive automatic operations, make comparison nearly frictionless.

Examples:

**Before / After**

**Original / Cleaned**

**Keep All / Final Take Only**

**Normal / Tight Pacing**

The user should not need to apply an operation, discover they dislike it, undo it, configure it, and retry repeatedly.

Automation should show its expected effect whenever practical.

---

# Batch Intelligence Without Batch Complexity

When the system detects many similar opportunities, surface them as a coherent task.

Instead of placing 37 icons on the timeline:

```text
Found 37 pauses

31 safe to shorten
4 may contain meaningful screen activity
2 occur inside interrupted speech

[Apply 31 safe]
[Review 6]
```

Similarly:

```text
Detected 9 likely retakes

6 high confidence
3 uncertain

[Collapse 6]
[Review all]
```

The application's intelligence should reduce cognitive load, not create more notifications.

---

# Confidence-Aware UX

Automatic systems should understand uncertainty.

High-confidence, nondestructive actions can be offered aggressively.

Low-confidence actions should be surfaced for review.

For example:

```text
AUTO EDIT

✓ 23 obvious pauses
✓ 11 filler words

Review:
? 3 possible retakes
? 2 visually important silent sections
```

Do not present uncertain AI inference as fact.

Do not force the user to review hundreds of trivial high-confidence decisions individually.

---

# Contextual Inspector

The inspector should change based on selection.

There should not be one enormous permanent panel containing every possible property.

Examples:

**Nothing selected**

* project
* sequence
* export status

**Video selected**

* transform
* crop
* speed
* stabilization
* visual effects

**Audio selected**

* volume
* cleanup
* EQ
* ducking

**Caption selected**

* text
* timing
* style

**Transcript selected**

* text correction
* speaker
* remove
* alternate takes

**Semantic event selected**

* event type
* confidence
* recommended actions

Advanced sections can expand when needed.

---

# Reduce Global Chrome

The top toolbar should contain only genuinely global operations.

Likely examples:

* Import
* Undo / Redo
* workspace/view controls
* search / command palette
* Auto Edit
* Export

Do not put every editing feature there.

Move actions toward:

* contextual floating controls
* selection toolbars
* right-click menus
* inspector sections
* timeline affordances
* transcript affordances
* command palette
* keyboard shortcuts
* guided next-step suggestions

The toolbar should remain relatively stable even as hundreds of capabilities are added.

---

# Command Palette as the Escape Hatch

Every meaningful capability should still be searchable.

A command palette can expose advanced functionality without making it permanently visible.

Examples:

```text
> remove pauses
> normalize selected audio
> find retakes
> zoom to cursor
> create chapter
> blur email addresses
> export captions
> show keyframes
```

This also gives AI agents and keyboard-centric users a natural conceptual model.

Context should influence ranking.

If an audio clip is selected, audio commands should appear first.

---

# Smart Empty States

When there is nothing meaningful to display, the interface should teach the next action.

Instead of:

**No transcript**

show:

```text
No transcript yet.

Transcribing lets you edit the video by editing words,
find retakes, remove filler, and generate captions.

[Transcribe]
```

Instead of an empty semantic-analysis panel:

```text
Analyze this recording to find:

• pauses
• retakes
• screen changes
• cursor activity
• possible errors

[Analyze]
```

Empty space is an opportunity to guide rather than merely report absence.

---

# Workflow Awareness

The application should understand the broad state of a project.

For example:

```text
IMPORT
   ↓
ANALYZE
   ↓
ROUGH CUT
   ↓
REVIEW
   ↓
POLISH
   ↓
EXPORT
```

This should not become a restrictive wizard.

Instead, it should allow the interface to prioritize useful actions.

During **Analyze**, surface transcription and detection.

During **Rough Cut**, surface cleanup, retakes, pacing, and structural changes.

During **Polish**, surface captions, zooms, audio cleanup, graphics, and continuity.

During **Export**, surface QA and output settings.

The user can jump anywhere at any time.

---

# Context-Aware Helpers

Build a reusable system for small in-place helpers.

A helper can contain:

* what was detected
* why it matters
* recommended action
* consequence
* alternatives
* likely next action
* optional deeper explanation

Example:

```text
┌─────────────────────────────────────────┐
│ Long pause detected                4.8s │
│                                         │
│ Nothing changes visually here.          │
│ Removing it is probably safe.           │
│                                         │
│ [Remove] [Shorten] [Keep]               │
│                                         │
│ Afterward: review the next pause →      │
└─────────────────────────────────────────┘
```

Another:

```text
┌─────────────────────────────────────────┐
│ Possible retake                         │
│                                         │
│ This sentence appears three times.      │
│ The last attempt is complete and is     │
│ followed by the successful action.      │
│                                         │
│ [Use final take] [Compare] [Keep all]   │
│                                         │
│ Saves approximately 26 seconds.         │
└─────────────────────────────────────────┘
```

These helpers should be a platform capability, not handcrafted separately for every feature.

---

# Context Engine

Create a central representation of editing context.

Conceptually:

```text
EditingContext {
    selection
    playhead
    nearbyEvents
    workflowStage
    activePanel
    transcriptSelection
    currentSpeaker
    mediaType
    analysisResults
    pendingSuggestions
    history
}
```

Features can register actions against conditions.

Conceptually:

```text
Action {
    id
    label
    description
    when(context)
    consequence(context)
    execute(context)
    suggestedNextActions(context)
}
```

This lets new features automatically participate in:

* contextual menus
* selection helpers
* command palette
* inspector
* next-step guidance
* AI agent tools

without manually wiring them into five different interfaces.

---

# Actions Should Be Discoverable More Than Once

Contextual design must not make capabilities impossible to find.

Important actions should generally be available through multiple appropriate surfaces:

```text
context helper
      +
right click
      +
command palette
      +
keyboard shortcut where useful
      +
inspector when appropriate
```

Avoid having one obscure location that users must memorize.

---

# Learn From User Behavior

Over time, the application can adapt its suggestions without rearranging the interface unpredictably.

For example:

```text
You almost always shorten pauses rather than remove them.

[Make "Shorten" the default]
```

or silently rank **Shorten** above **Remove** in contextual choices.

Possible learned preferences include:

* preferred pacing
* caption treatment
* zoom intensity
* whether to retain filler words
* silence duration
* loading-screen treatment
* preferred transition style
* common export format
* common resolution
* which automatic decisions are usually accepted

The application should become faster to use as the user uses it.

---

# UX Definition of Done

A feature is not complete merely because its underlying capability works.

Before considering a user-facing feature production-ready, ask:

1. **How does the user discover it?**
2. **Where does it appear when relevant?**
3. **Is the default choice obvious?**
4. **Does the user understand what will happen?**
5. **Can they preview or safely undo it?**
6. **What should they probably do next?**
7. **Can an expert access deeper controls?**
8. **Does adding this feature increase permanent UI clutter?**
9. **Can it participate in batch workflows?**
10. **Can the command palette and automation system invoke it?**

If a feature adds power but makes the application harder to understand, its UX is unfinished.

---

# Product Standard

The target feeling is:

> **"I barely need to know video editing, but whenever I want more control, it is there."**

Not:

> **"This has every feature Premiere has."**

And not:

> **"The AI does everything for me."**

The ideal interaction is:

```text
system understands context
        ↓
presents 2–4 useful choices
        ↓
explains meaningful consequences
        ↓
user makes obvious decision
        ↓
system performs normal reversible edit
        ↓
suggests logical next action
```

Power should live underneath simplicity.

The application should continually reduce the amount the user must **search for, remember, configure, and manually manipulate**.
