# Rating interpretation and stock-view correction — 2026-10-13

## Study boundary

Read the current handoff, project/operations memory, October 12 algorithm plan and full-universe replay before making new changes. Inspect live 1.2.6 production output separately from the local 1.5 candidate. Use the fixed 25/20/15/12/10/10/5/3 factor percentages and preserve complete canonical sorting. A score is an evidence-weighted research grade, not a probability of a 50% price gain.

## Reproduced problem

- At the 2026-10-13 read-only production check, DLO was **rank 1 of 7,518** but had an absolute score **52.13/100** on 1.2.6. Its factors were valuation 2.75, catalysts 5, financial strength 10, earnings quality 9.7, competitive position 2.53, downside risk 4, management 0 and technical timing 6.94. The arithmetic exactly matches the fixed weights.
- The live DLO profile says its intrinsic valuation is unavailable because corporate actions and dilution are not reconciled. Its other low dimensions have missing or incomplete research inputs. Live 1.2.6 also labels some proxy credit as evidenced; the local 1.5 work separates those concepts and removes catalyst credit without a reviewed future event.
- The frozen 7,517-row old-release distribution has mean score 10.16 and maximum 56.46. In the local 1.5 replay, the best score is 49.48 and mean model-input coverage is 25.17%. There are zero reviewed catalysts. Thus a top-ranked stock can be near 50 even when the score arithmetic is correct. Treat this as an interpretation and source-acquisition issue first; do not inflate a chosen ticker with invented missing facts or quietly rescale the fixed-weight score.
- A deeper source audit found **1,208** frozen rows with `splitAdjusted:true` although share-ratio provenance still explicitly says corporate actions were unverified. Of these, **883** need observations older than the scan's fixed 550-day history window. The flag conflates adjusted price history with verified share-count dilution; only the latter should unlock dilution or intrinsic-value credit. Revalidate saved rows against the underlying provenance, extend history lookback only where needed, and fail closed for unreviewed share classes. DLO's [2025 SEC 20-F](https://www.sec.gov/Archives/edgar/data/1846832/000207097926000113/dlo-20251231.htm) discloses both Class A and Class B common shares, so one listed class is not proof of one economic class.

## Work waves

1. **Rating audit:** independently reconstruct representative top and low scores, all factor denominators, source gates, availability and conflicts. Search for reproducible logic defects, especially valuation and corporate-action inputs. Fix only supported defects; rerun fixed-weight, all-universe and adversarial checks. If no scoring defect explains a gap, record the missing evidence precisely.
2. **Score communication:** show original rank and universe context prominently alongside the absolute score. Explain in the profile which dimensions are observed, which are model-only and which require research. Keep the score and its meaning unchanged.
3. **Card interaction and hierarchy:** make each whole card open its stock profile by mouse, touch and keyboard while copy/favorite controls retain independent actions. Reduce the outer card to identity, score/rank, last completed session price/date/change and a small research-status cue. Move detail into the profile.
4. **Profile hierarchy:** chart first, defaulting to the most recent daily session with an explicit data timestamp and honest unavailable state; immediately below, explain the company and its business. Put score breakdown, thesis, financials and source diagnostics later in the scroll.
5. **Verification and delivery:** run algorithm, runtime, research, SQLite, UI, typecheck, lint and production build; test real desktop/mobile browser card opening, nested actions, keyboard operation, chart default and profile order. Compare full-universe score/rank changes if scoring semantics change. Publish source in a draft PR. Production deployment remains gated by safe Railway volume headroom and approval for any paid capacity change.

## Acceptance

The user can see why the leading stock's absolute grade is near 50, identify genuine missing evidence separately from a code error, open any card surface, read the last completed session on the card, and land on the daily chart followed directly by a clear company description. Mathematical ranks, sources and private saved state stay intact.
