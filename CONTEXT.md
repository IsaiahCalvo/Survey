# Context — Survey

Glossary of domain language for the Survey app. Plain definitions only — no
implementation details.

## Glossary

### Template
A reusable survey definition (e.g. "Security"). Has a name, and contains
**Modules**. Selected at the start of a survey.

### Module
A phase of work within a Template (e.g. "Installation Phase", "Commissioning
Phase"). Contains **Categories**.

### Category
A thing being surveyed within a Module (e.g. "Cameras", "Doors"). Contains
**Checklist Items**. The same Category can be copied into more than one Module.

### Checklist Item
A single verification question within a Category (e.g. "Is the camera cable
pulled?", "Is the camera installed?").

### Highlight
An area drawn on a PDF in **Survey mode**. Each Highlight is assigned exactly
one Category and one Entity.

### Entity
A responsible party or status (e.g. "GC", "Subcontractor", "100% Complete",
"Removed"). An Entity is assigned to a **Highlight** and defines that
Highlight's color. Entities are defined per Template and chosen in Survey mode.
Previously called "Ball in Court" — the canonical term is now **Entity**.

### Survey mode
The in-app mode where a Template is applied to a PDF. The user is taken through
the Template's Modules, draws Highlights on the PDF, and assigns each Highlight
a Category and an Entity. The survey panel lists Categories, the Highlights
under each Category, and the Checklist Items under each Highlight.
