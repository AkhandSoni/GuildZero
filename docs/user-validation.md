# Representative CSV-user task session (#25)

Status: protocol prepared; no representative sessions or validated customer findings are claimed. Automated tests and desk research are separate evidence. Intended participants are people who regularly process sales or operations CSV exports.

Use a disposable demo login and the in-app synthetic CSV first. Never request a participant's account password, payment key or private customer export. A participant may instead supply a small anonymized dataset they explicitly approve. Explain that the operator pays with shared, valueless NEAR testnet tokens; no purchase, deposit or wallet connection is needed. Do not capture login screens, credentials or private CSV content in notes/recordings. Participation and any recording require that person's agreement.

Ask the participant to attempt the following tasks without pointing out controls. Observe first; record when assistance is needed. Use metadata-only processing if settlement is unavailable and record export as blocked, rather than inventing a completed export.

| Task | Observable success |
|---|---|
| Import a bounded CSV | Correct file appears in the dataset preview; source file remains unchanged |
| Choose numeric columns | Participant spots a text/currency-formatted column and excludes or corrects it without silent conversion |
| Save and launch | Private brief and saved options match intent; budget is understood as a cap, not a deposit |
| Review the outcome | Participant distinguishes verified work, human approval, payment pending/failed, and confirmed settlement |
| Obtain the result | Required exact payments confirm, then the participant finds the appropriate export and can identify its contents |
| Find and reuse work | Participant retrieves the mission through search/filter and creates an independent new draft without copying authorization |

Record a participant code (not personal contact data), date, source commit, prior CSV experience, synthetic/approved-data choice, assistance given and observed errors. For each task record: completed unassisted / completed with help / blocked / abandoned, elapsed time, the actual confusion and severity. Keep observations separate from interpretations. Do not infer demand from a single successful demonstration.

After each session, ask what output they expected, what they would do next, and which step they would not trust. Record an anonymous paraphrase unless explicit quotation permission is given. Compare observations across participants, then link concrete reproducible defects or changed requirements to GitHub issues. Report the actual sample size and limitations; no participant count or success rate is prefilled.

Store session notes in an operator-approved private location; record only sanitized findings in issues. Dataset backup/export retention and applicable jurisdiction require owner review under #44. This protocol is not legal/compliance certification or evidence that research has occurred.
