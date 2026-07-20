# The 50%+1 coalition for unity — who's in it, and how the core differs from the margin

`coalition_50plus1.py` builds the **minimum winning coalition** for a united Ireland: rank every
NILT-2019 respondent on a **unity-proximity axis** — direction tier (Yes > Don't-know > No), then
continuous **softness** within tier (soft = closest to flipping toward unity) — and walk down from
the top, accumulating weighted population, until **50%+1**. Then split that coalition into the
**pro-unity core** and the **recruited margin** and profile each.

Geography is unavailable in NILT (no council/DEA released), so area figures poststratify the
per-community inclusion rates onto the 2021 census composition by constituency.

**Level splice (stated up front).** NILT-2019 is the only wave carrying the full hardness battery,
and 2019 was a *low ebb* for Yes: raw universe shares (of those who'd vote) were **Yes 27.5% · DK
16.0% · No 56.5%**. The headline below anchors the pro-unity bloc at **today's ~45%** (matching
current polling) using the same proximity ordering; a provenance section reports the honest 2019
split for comparison.

---

## The headline coalition (anchored to today's ~45% pro-unity base)

| | share of pop | mean softness | what it is |
|---|---|---|---|
| **Coalition 50%+1** | 50.0% | 0.65 | the minimum winning bloc |
| **Part A — pro-unity core** | ~45% | 0.64 | today's Yes bloc |
| **Part B — recruited margin** | ~5.1% | **0.76** (softest) | the pivotal don't-know/pro-UK slice |

**The single most important structural finding: by the time unity reaches ~45%, the don't-knows are
already *inside* the coalition — the pivotal last 5%+1 is drawn from soft *pro-UK* voters, not from
the undecided.** This is arithmetic, not artifact: Yes (27.5%) + *all* don't-knows (16%) = 43.5%,
which is already below the 45% line, so the marginal recruits needed to cross 50% are necessarily
the **softest No voters**. Part B is **94.9% current-No, 5.1% don't-know**.

### Who the pivotal margin (Part B) actually is
The 5%+1 that decides it: **52% Protestant, 25% Catholic, 15% no-religion**; **66% "Neither"
identity, 24% Unionist**; the **oldest** tranche (40% are 65+); partisan-wise **Alliance 35% /
Don't-know 19% / UUP 10% / DUP 8%**; two-thirds urban. In one line: **soft, older, "neither"-
identifying, Alliance-adjacent Protestants of the greater-Belfast commuter belt** — the cross-
pressured unionist-background middle, not the nationalist base.

### The pro-unity core (Part A) for contrast
The ~45% bloc: **60% Catholic, 19% no-religion, 17% Protestant**; **47% Nationalist / 40% Neither /
8% Unionist**; partisan **SF 20 / SDLP 19 / Alliance 18 / DK 19**; 72% urban; the best-educated
group (31% degree). Note it is *already more religiously mixed than the old hard core* — today's
larger Yes bloc is the 2019 Catholic-nationalist core **plus** soft no-religion and soft-Catholic
converts, exactly the soft-convert thesis.

---

## Provenance — the same coalition split by *actual* 2019 vote

At the honest 2019 base the coalition is 27.5% already-Yes + 22.5% recruited (DK/No), so the
core-vs-margin contrast is starker and cleaner:

| | **A′ already-Yes** (27.5%) | **B′ recruited DK/No** (22.5%) |
|---|---|---|
| Community | **78% Catholic**, 14% none, 7% Prot | 38% Prot, 30% Cath, **24% none** |
| Identity | **69% Nationalist**, 29% Neither | **60% Neither**, 19% Unionist, 10% Nat |
| Party | **SF 32 / SDLP 23** / Alliance 19 | **DK 30 / Alliance 21 / None 15** |
| Urban | 67% | **78%** |
| Age skew | older-balanced | slightly younger (more 25–34) |

The contrast is the whole story: the **core is ethnically and politically rooted** — Catholic,
Nationalist-identifying, Sinn Féin/SDLP-voting, spread across the nationalist west and Belfast. The
**margin is the un-rooted middle** — religiously mixed with a large no-religion and Protestant
share, **"Neither" by identity, Alliance/None/Don't-know by party, more urban** and a little younger.
The coalition wins only by fusing a mobilised ethnonational base with a persuadable non-aligned
centre that does *not* share its identity.

---

## Geography of the 50%+1

Per-community inclusion: **81% of Catholics, 51% of no-religion, 24% of Protestants** fall inside the
coalition; the recruited margin is **6.2% of Protestants, 4.2% of none, 3.6% of Catholics**.
Poststratified to constituencies:

**Where the coalition is densest** (share of residents inside the 50%+1): **Belfast West 70% ·
Foyle 68% · South Down 65% · West Tyrone 64% · Mid Ulster / Newry & Armagh 64%** — the nationalist
west and border. Here the coalition is large *and* secure: recruits are only ~6% of it.

**Where the margin decides it** (recruits as a share of the local coalition — the *least secure*
part of the winning bloc): **North Down 15% · Belfast East 15% · Strangford 14% · East Antrim 14% ·
Lagan Valley 13% · North Antrim 12%** — the **Protestant/Alliance greater-Belfast and Antrim east**.
The coalition is a minority of residents there (~37–43%), but its *marginal* growth — the votes that
actually turn 45% into 50%+1 — is concentrated in exactly this belt. **The referendum is won in the
west and decided in the east**: the base lives west of the Bann, the pivotal converts live in the
eastern commuter suburbs.

---

## Caveats

- **Level splice**: profiles use 2019 microdata (only wave with the battery); the ~45% anchor is a
  reconstruction, not a re-survey. The *ordering* (who is nearer flipping) is the robust output, not
  any single share to the decimal.
- **Strict tiers** put all don't-knows ahead of all committed-No. Interleaving by softness would move
  a few soft-No ahead of hard-DK, but the headline (DKs mostly inside a 45% coalition → pivotal slice
  is soft pro-UK) is arithmetically robust to the ordering.
- **Geography is religion-poststratified** (NILT has no fine geography), so within-community identity
  variation across seats (e.g. soft "garden-centre" unionism in North Down) is captured only through
  the community rates, not seat-specific attitudes.
- Softness is a **within-wave attitude composite**, not observed switching (NILT has no panel).

Outputs: `coalition_50plus1.json`, `coalition_geography_constituency.csv`.
