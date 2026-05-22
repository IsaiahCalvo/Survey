# Area 11 — Form designer · **CHILD-FILED (KAL-55)**

- `FormDesigner` is referenced from `src/components/SyncfusionPDFContainer.jsx`. The Syncfusion FormDesigner API is wired at the container level.
- **KAL-47 (Survey-native form designer UI on Syncfusion FormDesigner API) not in main** — the kal-47 commit (`d4cf4611`) lives only on the kal-47 branch. The Forms toolbar / text / checkbox / radio / signature placement controls + properties panel are all on that branch, not on main.
- The disposable form-test.pdf (with one text field + one checkbox, via pdf-lib) generates correctly (`artifacts/form-test.pdf`, 2947 bytes) so the input fixture is ready when KAL-47 lands.
- Tracked under **KAL-55**.
