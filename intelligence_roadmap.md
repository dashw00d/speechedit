# Intelligence Roadmap

## Purpose

Build a video editor that becomes dramatically more intelligent over time **without requiring advanced intelligence to be useful at launch**.

The initial product should assume:

* models are imperfect
* local models are relatively small
* inference must be affordable and reasonably fast
* models understand ordinary language better than specialized domains
* models will misclassify events
* models will occasionally choose the wrong take
* visual understanding will be incomplete
* semantic relationships will sometimes be ambiguous
* domain-specific concepts such as game victories, compiler failures, sales objections, or meeting decisions will often be missed
* users must be able to correct intelligence quickly

This is not a temporary compromise.

It is an architectural principle.

The editor must remain useful when intelligence is mediocre and become extraordinary as intelligence improves.

---

# North Star

The long-term system should progressively transform media through:

```text
MEDIA
  ↓
SIGNALS
  ↓
OBSERVATIONS
  ↓
SEMANTIC EVENTS
  ↓
RELATIONSHIPS
  ↓
INTENT-AWARE DECISIONS
  ↓
EDIT SUGGESTIONS
  ↓
NORMAL EDITING OPERATIONS
  ↓
TIMELINE
  ↓
RENDER
```

At no point should an AI model secretly become the project model.

Models observe, classify, relate, rank, and suggest.

The project's normal editing operations remain the authority.

---

# Core Rule

## Intelligence may improve. The editor contract must remain stable.

Whether an event was identified by:

* a deterministic audio threshold
* Whisper
* a 4B language model
* a multimodal 9B model
* a fine-tuned retake classifier
* a game-specific detector
* a future frontier multimodal model

the rest of the application should receive approximately the same normalized object.

For example:

```ts
Observation {
    type
    range
    confidence
    source
    evidence
    labels
    metadata
}
```

Higher-level intelligence can then produce:

```ts
Event {
    type
    range
    confidence
    labels
    participants
    relatedEvents
    evidence
}
```

And editing intelligence produces:

```ts
Suggestion {
    reason
    range
    confidence
    proposedOperations
    alternatives
    provenance
}
```

The editor executes normal commands such as:

```text
deleteRange()
shortenRange()
setSpeed()
protectRange()
splitClip()
replaceTake()
setTransform()
addZoom()
addCaption()
addOverlay()
createSequence()
```

This contract should survive every generation of intelligence we add.

---

# Architecture: Intelligence as Layers

The system should distinguish between five levels.

```text
L0  Signals
L1  Observations
L2  Semantic Events
L3  Relationships / Structure
L4  Editorial Judgment
```

Each layer should be independently replaceable and improvable.

---

## L0: Signals

Signals are measurements that require little or no semantic intelligence.

Examples:

* audio level
* silence
* speech probability
* motion
* scene difference
* black frames
* waveform
* frame activity
* cursor-like movement
* face presence
* OCR text
* timestamps
* shot boundaries
* audio channels
* subtitle words
* speaker embeddings
* image embeddings

These should be cheap, cacheable, deterministic where possible, and reusable by every later model.

### Principle

**Never ask an expensive model to rediscover something a cheap deterministic process already knows.**

---

# L1: Observations

Observations describe something relatively concrete.

Examples:

```text
speech occurred
speaker changed
screen remained static
text changed
cursor moved
UI region changed
face appeared
sentence repeated
long pause occurred
high audio energy occurred
new scene began
```

An observation does not need to understand why something happened.

For example:

```text
00:44.2–00:50.8

speech: false
visual_change: very_low
motion: low
cursor_activity: false
```

is useful without knowing whether the user was:

* waiting for npm
* reading a document
* staring at a loading screen
* thinking
* watching a cutscene

The editor can already offer:

```text
Long inactive section · 6.6s

[Remove]
[Shorten]
[Speed Up]
[Keep]
```

That is MVP-level intelligence.

---

# L2: Semantic Events

Semantic events attempt to answer:

> What appears to be happening?

Examples:

```text
introduction
explanation
question
answer
retake
attempt
failure
success
reaction
navigation
demonstration
waiting
topic change
repetition
aside
instruction
result
```

These should remain reasonably generic.

Avoid making the fundamental event vocabulary depend on specific industries.

For example, prefer:

```text
event: failure
labels:
  software
  terminal
```

over creating:

```text
NpmCompileFailureEvent
```

Likewise:

```text
event: success
labels:
  gameplay
  high_energy
```

is preferable to hard-coding:

```text
BossKillEvent
```

Domain-specific models can add those labels later.

---

# L3: Relationships and Structure

This is where intelligence becomes significantly more valuable.

The system begins connecting events.

Examples:

```text
Take B supersedes Take A

Attempt 3 succeeds after Attempt 2 fails

Sentence 4 repeats the explanation from Sentence 2

This screen action corresponds to this spoken instruction

This answer belongs to this question

These six moments discuss the same topic

This reaction follows this event

This explanation depends on the previous setup step
```

Now we can represent:

```text
TOPIC
  ├─ explanation A
  ├─ explanation B
  └─ explanation C
```

or:

```text
TASK
  ├─ attempt 1 → failure
  ├─ attempt 2 → failure
  └─ attempt 3 → success
```

This is where editing begins to move beyond conventional NLEs.

---

# L4: Editorial Judgment

The final intelligence layer asks:

> Given what the user wants, what should we do about what happened?

The answer depends on intent.

The same event can produce different edits.

For example:

```text
Event:
failed attempt
```

### Polish

Remove obvious failed attempt.

### Condense

Remove unless necessary to understand the result.

### Construct

Keep if it teaches something important.

### Mine

Potentially rank highly if it produced a strong reaction.

Analysis and judgment must therefore remain separate.

---

# The Four Universal Editing Intents

Do not create separate intelligence architectures for meetings, streams, tutorials, demos, podcasts, interviews, and other markets.

Use four broad editing intentions.

---

## Polish

> Keep essentially the same recording, but make it good.

Typical operations:

* remove obvious mistakes
* tighten pauses
* remove filler
* collapse obvious retakes
* improve audio
* improve framing
* captions
* visual cleanup

Suitable for:

* screen demos
* async updates
* walkthroughs
* presentations
* simple tutorials

---

## Condense

> Preserve the useful information while substantially reducing time.

Typical intelligence:

* topic importance
* repetition
* tangents
* dependency
* pacing
* information density

Typical operations:

* shorten
* remove
* summarize
* compress
* select best explanation

Suitable for:

* meetings
* podcasts
* lectures
* webinars
* long tutorials

---

## Mine

> Find useful moments inside far more footage than anyone wants to watch.

Typical intelligence:

* novelty
* energy
* relevance
* reactions
* self-containedness
* topic matching
* interesting events

Typical operations:

* rank
* search
* extract
* collect
* assemble

Suitable for:

* streams
* interviews
* user research
* podcasts
* long events

---

## Construct

> Build a specific finished sequence from the available material.

Typical intelligence:

* ordering
* dependencies
* takes
* attempts
* narrative structure
* successful path
* supporting material

Typical operations:

* select
* arrange
* replace
* assemble
* annotate
* pace

Suitable for:

* tutorials
* courses
* guides
* SOPs
* structured content

---

# Intelligence Stage 0: Deterministic Foundation

## Goal

Make useful automatic editing possible before depending heavily on language or multimodal models.

### Capabilities

Build and cache:

* silence detection
* audio activity
* VAD
* waveform
* shot changes
* visual activity
* static-frame detection
* OCR
* face detection
* image embeddings
* audio embeddings where useful
* transcript timestamps
* speaker embeddings
* frame thumbnails

### Initial useful decisions

```text
Long silence
→ Remove / Shorten / Keep

Static video + no speech
→ Remove / Speed / Keep

Speech + static video
→ Preserve

Visual activity + silence
→ Preserve or review

Repeated transcript text
→ Possible retake

Very short clip between cuts
→ Possible accidental fragment
```

### Value

The application can already automate a meaningful portion of:

* screen demos
* presentations
* talking-head recordings
* simple tutorials

without needing a particularly smart model.

---

# Intelligence Stage 1: Generic Local Language Intelligence

## Goal

Use relatively small local models to add useful semantic understanding without expecting strong domain expertise.

This is the intended MVP intelligence level.

### Expected model behavior

The model should be reasonably capable of understanding:

* sentences
* conversational structure
* repetition
* false starts
* obvious corrections
* obvious retakes
* topics
* questions
* answers
* instructions
* obvious mistakes
* broad semantic similarity

It should **not** be trusted to reliably understand:

* game-specific mechanics
* obscure application UI
* whether a particular compile was semantically successful
* sales methodology
* medical terminology
* complex meeting politics
* specialized technical processes
* subtle humor
* domain-specific importance

### MVP model jobs

Small models should perform narrow tasks such as:

```text
classify sentence
compare candidate retakes
group similar explanations
name topic segment
score semantic similarity
identify likely false start
identify likely correction
rank candidate keepers
```

Avoid giant prompts asking:

> Understand this entire three-hour video and edit it perfectly.

---

# MVP Philosophy

The MVP should behave like:

> **A very fast junior editor who notices a lot, gets some things wrong, and makes every correction easy.**

Not:

> **An autonomous professional editor.**

This distinction should drive the UX.

---

# MVP Confidence Model

Every intelligent result should have an effective confidence tier.

### High Confidence

Examples:

* 9-second silence with no meaningful visual change
* exact repeated sentence followed by a cleaner take
* obvious filler word
* static loading span

UX:

```text
23 safe cleanups

[Apply]
```

### Medium Confidence

Examples:

* likely retake
* likely tangent
* likely duplicate explanation
* candidate chapter boundary

UX:

```text
Possible retake

[Use later take]
[Compare]
[Keep both]
```

### Low Confidence

Examples:

* model believes this failed attempt is unnecessary
* suspected joke
* inferred semantic dependency
* uncertain highlight

UX:

Do not automatically alter the project.

Surface only when useful.

---

# MVP Correction Must Be Cheaper Than Manual Editing

When intelligence is wrong, the fix should usually be:

```text
Put Back
Keep This
Use Other Take
Retag
Protect
Retarget
Change Bounds
```

Never:

> Go rebuild the edit manually on the timeline.

For example:

```text
Possible retake

Take A
Take B
Take C

[Use A]
[Use B]
[Use C]
[Keep All]
```

The user teaches the system which interpretation is correct while fixing their project at the same time.

---

# Intelligence Stage 2: Generic Multimodal Understanding

## Goal

Move beyond understanding words independently from pictures.

Combine:

* transcript
* audio
* OCR
* frames
* motion
* cursor activity
* speaker state
* scene changes

Now the system can infer relationships such as:

```text
speaker says "click settings"
+
cursor moves
+
UI changes
+
OCR reveals "Settings"

→ likely referenced visual target
```

or:

```text
speaker says "that didn't work"
+
terminal changes
+
new red/error-like visual state

→ likely failed attempt
```

The important advancement is not simply using a bigger model.

It is **cross-modal grounding**.

---

# Stage 2 Features

Potential capabilities:

### Visual-aware silence handling

Understand that a silent span can contain meaningful activity.

### Semantic screen targeting

Associate words with visible controls or regions.

### Better retake detection

Compare both what was said and what happened visually.

### Better attempt grouping

Recognize repeated attempts at accomplishing the same thing.

### Generic success/failure inference

Without knowing the exact domain.

### Better chaptering

Use both speech and scene changes.

### Better highlight scoring

Combine speech, visual events, reactions, and novelty.

### Visual continuity checks

Detect when an automatic cut hides an important state change.

---

# Intelligence Stage 3: Persistent Project Understanding

## Goal

Stop treating every chunk independently.

Create an evolving understanding of the recording.

Represent:

```text
People
Topics
Objects
Applications
Tasks
Attempts
Results
Questions
Answers
References
Dependencies
```

The system can now reason across longer spans.

For example:

```text
At 02:14 they introduced the database.

At 18:42 they returned to it.

At 27:10 they fixed the problem introduced earlier.
```

This enables:

* stronger condensing
* better dependency preservation
* better highlight context
* self-contained clip extraction
* narrative reconstruction
* meaningful search

---

# Semantic Graph

Long-term, build a time-aligned semantic graph.

Conceptually:

```text
Speaker A
    ↓ explains
Topic: Authentication

Topic: Authentication
    ↓ demonstrated_by
Screen Event 124

Screen Event 124
    ↓ attempted_by
Attempt 4

Attempt 4
    ↓ resulted_in
Failure 2

Failure 2
    ↓ corrected_by
Attempt 5

Attempt 5
    ↓ resulted_in
Success 1
```

The graph should not replace the timeline.

It explains the timeline.

---

# Intelligence Stage 4: User-Adaptive Intelligence

## Goal

Make the editor learn the user's preferences before trying to become universally smarter.

Every correction is potentially useful training data.

Examples:

```text
User restores comic pauses.

User usually chooses later retakes.

User keeps explained failures.

User prefers 400ms conversational pauses.

User rejects clips requiring prior context.

User likes subtle zooms.

User preserves profanity.

User rejects high-energy clips without narrative payoff.
```

Store preferences separately from raw observations.

Do not distort analysis to match preferences.

Instead:

```text
OBSERVATION:
pause = 1.4 sec

USER PREFERENCE:
usually shorten to ~500ms
```

Then the decision engine combines them.

---

# Personal Editing Profile

Eventually:

```text
EditingProfile {
    pauseStyle
    fillerPolicy
    retakePreference
    zoomStyle
    captionStyle
    pacing
    highlightPreference
    failureTreatment
    profanityPolicy
    defaultOutputs
}
```

This can produce large gains without requiring a vastly more capable base model.

---

# Intelligence Stage 5: Learned Generic Editing Models

## Goal

Use accumulated corrections and accepted/rejected suggestions to train models specifically for editing decisions.

By now the system has valuable labeled data:

```text
model suggested cut
user accepted

model suggested cut
user restored

retake candidate A/B/C
user selected B

highlight candidate
user rejected

topic split
user merged

attention target
user retargeted
```

This is extraordinarily valuable supervision.

---

# Training Data Strategy

Store provenance for every intelligent decision.

Conceptually:

```ts
DecisionRecord {
    sourceSignals
    observations
    semanticContext
    modelSuggestion
    confidence
    userAction
    finalOutcome
}
```

Over time this creates datasets for:

* retake ranking
* pause treatment
* highlight ranking
* importance scoring
* attention targeting
* topic boundaries
* clip boundary selection
* success/failure classification
* edit confidence calibration

The application effectively creates its own training data while being used.

---

# Stage 6: Pluggable Domain Intelligence

## Goal

Add specialized knowledge without turning the core editor into a collection of vertical applications.

This is where domain-specific models belong.

Not earlier.

---

# Domain Models Should Be Plugins

A domain model should add **knowledge**, not new editing architecture.

Examples:

### Software Development

Detect:

```text
terminal command
compile
test
error
warning
successful build
file
function
code selection
```

Emit generic events:

```text
failure
success
attempt
instruction
attention_target
```

with:

```text
labels:
  software
  terminal
  compiler
```

---

### Gaming

Detect:

```text
death
victory
round start
round end
boss
objective
inventory
loading
```

Emit:

```text
success
failure
reaction
notable_event
waiting
navigation
```

---

### Meetings

Detect:

```text
decision
action item
owner
objection
question
agreement
disagreement
```

Emit generic semantic objects plus domain labels.

---

### Sales

Detect:

```text
pricing
objection
competitor
next step
product demonstration
buying signal
```

Again, these enrich the semantic graph.

They do not create a new timeline engine.

---

# Domain Plugin Contract

Conceptually:

```ts
DomainAnalyzer {
    id
    supportedInputs
    detect(context)
    outputs
}
```

It should produce standard:

```text
Observation
Event
Relationship
Score
```

objects.

The rest of the editor should not care which model produced them.

---

# Stage 7: Fine-Tuned Specialized Models

## Goal

Once enough labeled data exists, replace general-model approximations with small, extremely good specialists.

Examples:

```text
RetakeRanker-1B
HighlightRanker-2B
ScreenAttention-1B
TopicBoundary-500M
TutorialAttemptClassifier-2B
MeetingDecisionClassifier-1B
GamingMomentRanker-2B
```

These models can be:

* faster
* cheaper
* more consistent
* easier to calibrate
* easier to run locally

than repeatedly invoking one enormous general-purpose model.

---

# Mixture of Specialists

Eventually the intelligence stack may resemble:

```text
                     ORCHESTRATOR
                          │
        ┌─────────────────┼────────────────┐
        ▼                 ▼                ▼
    transcript        visual           audio
    semantics         semantics         semantics
        │                 │                │
        └─────────────────┼────────────────┘
                          ▼
                      event graph
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
    retake model      highlight model    importance model
        │                 │                  │
        └─────────────────┼──────────────────┘
                          ▼
                    decision engine
```

A large model may orchestrate.

Small specialists do the repetitive work.

---

# Stage 8: Advanced Domain-Trained Multimodal Models

At the far end, domains can have genuinely deep understanding.

A coding model might understand:

> The first compile failed because the imported type was incorrect, the presenter explains that failure, and the third attempt contains the clean final solution.

A gaming model might understand:

> This death is more useful than the victory because the player explains the mechanic immediately afterward.

A meeting model might understand:

> This sounds like agreement, but the actual final decision occurs eight minutes later after an objection changes the scope.

These are extremely useful capabilities.

They should enhance the same architecture established by the MVP.

They should not require rebuilding it.

---

# Stage 9: Editing Planner

Eventually a highly capable model can operate above the semantic graph.

User:

> Make this into a fast tutorial. Keep the first failure because it explains the problem, remove the other retries, don't cut anything needed to reproduce the solution, and keep it under 12 minutes.

Planner:

```text
Goal:
tutorial

Constraints:
duration <= 12:00
preserve reproducibility
preserve first instructional failure

Plan:
1. protect required setup
2. select canonical successful path
3. retain instructional failure
4. remove superseded attempts
5. collapse repeated explanations
6. compress inactive waits
7. generate attention targets
8. produce captions
9. run continuity QA
```

Each step compiles into normal suggestions and editing operations.

The planner does not manipulate media independently.

---

# Intelligence Stage 10: Specialized Editing Agents

At the far end, specialized agents can collaborate.

Examples:

```text
Story Editor
Pacing Editor
Continuity Editor
Audio Editor
Caption Editor
Visual Framing Editor
Highlight Editor
QA Editor
```

Each receives the same project and semantic representation.

Each proposes ordinary reversible edits.

For example:

### Pacing Editor

> These five pauses are slowing the section.

### Continuity Editor

> Removing this range hides the UI transition required to understand the next step.

### Visual Editor

> The referenced control occupies only 3% of the frame. Reframe during this explanation.

### QA Editor

> The narration says “click Save,” but the Save action was removed from the current cut.

This is where the system begins to resemble an editing team.

---

# What We Should NOT Do

## Do not wait for brilliant models

A mediocre local model plus excellent correction UX can already save enormous time.

---

## Do not build domain-specific vertical products into the core

Avoid:

```text
if streamer
if podcast
if meeting
if tutorial
```

Use:

```text
signals
events
labels
relationships
recipes
plugins
```

---

## Do not let models directly mutate project state

Models produce suggestions.

Commands change the project.

---

## Do not repeatedly analyze the same information

Cache low-level signals and semantic results.

Later intelligence should build on earlier layers.

---

## Do not use giant models for every task

A 500M classifier that performs one narrow task extremely well is preferable to invoking a 30B model unnecessarily.

---

## Do not hide uncertainty

Confidence should affect automation behavior.

---

## Do not require intelligence to understand every domain

The MVP should remain useful even when the model thinks:

```text
something changed here
```

instead of:

```text
the React TypeScript compile succeeded after correcting
a discriminated union mismatch
```

The first observation can still produce a useful edit.

---

# MVP Intelligence Target

The first genuinely useful release does **not** need deep multimodal reasoning.

It needs:

### Reliable foundations

* transcription
* word timestamps
* silence
* VAD
* visual activity
* static-span detection
* scene changes
* basic speakers
* waveform
* thumbnails

### Good-enough generic semantics

* sentence segmentation
* topics
* likely filler
* likely false starts
* likely retakes
* semantic similarity
* obvious repetitions
* broad event labels
* rough importance scores

### Simple cross-modal logic

```text
speech + no visual activity
silence + visual activity
silence + no activity
repeated speech + repeated visual sequence
topic change + screen change
```

### Excellent correction UX

* Put Back
* Protect
* Use This Take
* Compare
* Retag
* Retarget
* Change Bounds
* Undo
* Apply Similar

### A strong review model

```text
Applied safely: 42

Review:
  3 possible retakes
  2 uncertain inactive spans
  1 possible duplicate explanation
```

That is enough to build a compelling product.

---

# MVP Product Promise

The promise should not be:

> **AI edits your video perfectly.**

It should be:

> **The app does the obvious work, shows you the questionable decisions, and makes fixing mistakes dramatically faster than editing manually.**

This creates realistic expectations while still delivering significant value.

---

# MVP Primary Wedge

Initially optimize hardest for:

> **One long talking/screen recording → one polished recording.**

This corresponds to the strongest capability already emerging in the current system: transcript editing, pause/filler cleanup, captions, retake handling, basic scene structure, and manual visual polish.

It also creates the analysis and correction data needed for later intelligence.

Do not delay the MVP waiting for:

* game-state recognition
* meeting decision extraction
* multi-session research
* automatic Shorts
* advanced multimodal reasoning
* perfect cursor reconstruction
* domain models

Those are later multipliers.

---

# Development Sequence

## Phase A: Make Observation Excellent

Prioritize:

```text
timestamps
transcript
silence
activity
scene boundaries
OCR
speaker data
visual changes
```

These become permanent infrastructure.

---

## Phase B: Make Corrections Effortless

Before making the model dramatically smarter, make every common mistake take one click to repair.

This increases usefulness immediately and starts producing labeled correction data.

---

## Phase C: Add Generic Semantic Models

Introduce:

```text
retakes
topics
repetition
false starts
importance
attempts
broad success/failure
```

Use small local models.

---

## Phase D: Build the Semantic Graph

Connect:

```text
take → supersedes → take

attempt → results_in → failure

failure → corrected_by → attempt

speech → references → visual region

topic → contains → events
```

---

## Phase E: Build Cross-Modal Intelligence

Combine speech, screen, audio, OCR, motion, and events.

---

## Phase F: Learn User Preferences

Use accepted/rejected/corrected suggestions to personalize editorial judgment.

---

## Phase G: Train Generic Specialists

Fine-tune high-volume tasks where collected data proves specialists can outperform generic prompting.

---

## Phase H: Introduce Domain Plugins

Add optional specialized understanding for markets where it creates substantial value.

---

## Phase I: Train Domain Specialists

Fine-tune compact models using corrected domain-specific data.

---

## Phase J: Add High-Level Planning

Allow increasingly capable models to compose generic primitives and specialists into sophisticated editing plans.

---

# The Intelligence Ladder

The evolution should look like:

```text
DETERMINISTIC SIGNALS
        ↓
GENERIC SMALL LOCAL MODELS
        ↓
GENERIC MULTIMODAL MODELS
        ↓
PROJECT-WIDE SEMANTIC GRAPH
        ↓
USER-ADAPTIVE DECISION MAKING
        ↓
GENERIC FINE-TUNED SPECIALISTS
        ↓
OPTIONAL DOMAIN PLUGINS
        ↓
DOMAIN-TRAINED SPECIALISTS
        ↓
MULTIMODAL DOMAIN EXPERTS
        ↓
HIGH-LEVEL EDITING PLANNER
        ↓
COLLABORATING SPECIALIST AGENTS
```

The critical property is:

**Every step improves the quality of decisions without changing the underlying editing architecture.**

---

# Product Maturity Progression

### Early

> “I detected some things that probably waste time.”

### Better

> “I think these are retakes, waits, and repeated explanations.”

### Strong

> “These three attempts accomplish the same goal. The third succeeds.”

### Specialized

> “This compile succeeds; the previous two fail.”

### Expert

> “Keep the first failure because it contains the useful explanation, then jump to the successful third attempt.”

### Exceptional

> “I can produce a 9-minute tutorial that preserves every prerequisite, retains the pedagogically useful failure, removes redundant attempts, keeps code readable, and passes continuity QA.”

The interface does not need to fundamentally change between those generations.

The suggestions simply get better.

---

# Long-Term Moat

The long-term advantage should not simply be access to a better foundation model.

Models will commoditize.

The durable system is:

```text
generic media representation
+
semantic event graph
+
shared editing command architecture
+
confidence-aware decision engine
+
frictionless correction UX
+
user preference learning
+
large corpus of accepted/rejected editing decisions
+
specialized editing models
+
optional domain intelligence
```

That creates a compounding loop:

```text
better intelligence
      ↓
better suggestions
      ↓
more usage
      ↓
more corrections
      ↓
better training data
      ↓
better specialists
      ↓
better intelligence
```

---

# Final Principle

We should never ask:

> **Is the AI intelligent enough to understand this entire video?**

Ask:

> **What is the cheapest reliable level of understanding that lets us save the user another piece of manual editing work?**

At first that may simply be:

> “This is silent and nothing changed.”

Later:

> “This looks like a repeated attempt.”

Later:

> “This attempt failed and the next succeeded.”

Eventually:

> “This failure should remain because it teaches something the successful take does not.”

Every level is useful.

Every level builds on the same foundation.

And none requires the product to wait for the next generation of AI before becoming a serious video editor.
