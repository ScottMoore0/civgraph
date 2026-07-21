# Feasibility: integrating STV transfers into the model

## Why transfers are worth the trouble

Everything the model currently uses measures either **composition** (census) or **stated attitude**
(NILT/LucidTalk topline). Transfers are the one source of **revealed second-dimension behaviour**:
when a candidate is eliminated, where their votes *actually go* exposes the axis nothing else can —
is a UUP voter's next choice DUP (hard) or Alliance (soft)? does a Sinn Féin vote leak to SDLP or stop
dead (tribal)? That is precisely the signal the softness / persuadable-middle / area-uncertainty
layers are starved of, and precisely what pinned the North Antrim anti-Agreement UUP. So transfers are
high-value — *if* extracted honestly.

## What the data actually contains (grounded in the count sheets)

- **Have**: per-candidate running total + net transfer at **each count**, per constituency, for every
  STV contest (Assembly 1998+, local 1973+, European 1979–2019). Confirmed: **fractional transfer
  values** (WIGM/Gregory — e.g. a −732.98 surplus), quota, valid poll, spoiled.
- **Derivable**: per-count source→destination flow, and the **non-transferable** increment as the
  residual (`parcel − Σ destination gains`) — it is *not* stored (`nonTransferable: []`) but is
  recoverable because every candidate's per-count delta is present.
- **Do NOT have**: ballot-level ranked preferences (the raw marked ballots). NI does not publish these
  except a handful of electronically-counted pilots. This is the binding constraint below.

## Each complexity you named, and how it must be handled

1. **One source per count (not all candidates transfer at once).** The count structure is
   event-based — each count is a single distribution (an elimination, or one candidate's surplus). The
   source is identifiable (its total falls / it is elected-over-quota or eliminated); the destinations
   are the candidates whose totals rise. **✓ handled natively** by walking the count sequence.

2. **Destinations depend on who is still standing.** A parcel only reaches *continuing* candidates; a
   ballot's true next preference is skipped if that candidate is already elected or eliminated, flowing
   to a later one. So every measured flow is an **effective-next-usable-preference conditional on the
   elimination order**, not a raw 2nd preference — it is **path-dependent**. Handling: record the
   continuing-candidate set at each event and treat flows as *conditional*; prefer **early counts**
   (fuller field) for the cleanest preference reads, and model the conditioning rather than ignoring
   it. Measurable, but never interpret a late transfer as an unconditional 2nd choice.

3. **Non-transferables must be accounted for.** Recoverable as the residual, and they are a
   **first-class signal, not a nuisance**: a high plumping / non-transfer rate *is* tribal, tight,
   hard voting; willingness to transfer across the divide *is* softness. So the model gains a
   "transfer-exhaustion" covariate for free — provided the residual is computed and never dropped.

4. **Fractional / surplus values.** Confirmed fractional here, so flows are in **vote-value, not
   voter-count**. A surplus of 732.98 at transfer value <1 represents *more ballots* than 733 voters.
   For behavioural inference (voter counts) this distorts; the pipeline must either work in vote-value
   consistently or reconstruct ballot counts via the transfer value (`parcel / value`). Surplus
   transfers (last-parcel Gregory examines only the *last* parcel received) carry cleaner provenance
   than eliminations but are a **non-random subsample** of a candidate's pile — a second caveat.

5. **Compound provenance — the decisive limit.** When candidate B is eliminated, B's *entire* pile
   moves, and that pile blends B's own first-prefs with votes B received earlier from A (fractionally,
   possibly via several intermediates). The count sheet treats it as one parcel; it **cannot separate
   "original-B voters' onward choice" from "A-voters-who-passed-through-B."** True decomposition needs
   the ballot-level preference records, which we do not have. Therefore the model may use the
   **blended, conditional onward flow** — honestly labelled as "the onward behaviour of everyone in
   B's pile at that stage" — but must **not** claim pure first-preference-voter second choices from
   count sheets. Only where ballot data exists (rare) is full provenance recoverable.

## What is feasible vs not

**Feasible (and valuable):** a per-constituency / per-DEA **transfer-behaviour covariate layer** —
terminal-transfer split by party-pair (UUP→DUP vs UUP→Alliance vs non-transferable), cross-community
transfer/leakage rate, and plumping rate — computed with explicit fractional-value accounting,
continuing-candidate conditioning, and non-transferable residuals. These become **area-level
second-dimension covariates** feeding the softness / persuadability / area-uncertainty layers, and
they can be **pooled across many count events and constituencies with an ecological / regression
transfer-estimation model** (the standard psephological approach) to estimate underlying transfer
propensities while modelling the conditioning.

**Not feasible from count sheets:** clean individual second preferences or full provenance
decomposition — that needs unpublished ballot data. Ecological pooling recovers *average* propensities
under assumptions; it cannot give any single voter's ranking.

## Scope and how it plugs in

- **STV contests only**: Assembly, local, European (pre-2020). Westminster (FPTP) and referendums have
  no transfers, so transfers **enrich the election side and the area-softness surface**, and touch the
  unity/referendum estimate only *indirectly* — via the softness/cross-community-openness covariates
  they produce (e.g. locating soft vs hard unionism, as in the North Antrim case).
- Integration point: the covariates join the **v11 softness / persuadability / area-uncertainty**
  layer as revealed-behaviour features alongside the survey-derived softness, and can down-weight or
  correct NI-average survey rates where local transfer behaviour says an area is harder/softer than
  its demographics imply.

## Verdict

- **Aggregate, conditional, area-level transfer behaviour: FEASIBLE and genuinely additive** — a new
  revealed-preference axis the model has never had, directly useful for softness, the persuadable
  middle, and leadership-driven outliers.
- **Pure individual provenance / clean 2nd preferences: NOT feasible** without ballot-level data NI
  doesn't publish. The integration must therefore be as **carefully-caveated area covariates**
  (vote-value units, path-dependent, blended provenance, STV-only), never as clean voter preferences.
- **Effort**: moderate-to-high — count-sheet parsing across contests is fiddly but bounded; the
  honest ecological transfer-estimation and the conditioning model are the real work. The payoff is a
  behavioural second dimension for the whole softness machinery.
