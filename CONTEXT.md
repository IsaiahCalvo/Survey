# Context — Survey

Glossary of domain language for the Survey app. Plain definitions only — no
implementation details.

## Glossary

### Template
A reusable survey definition (e.g. "Security"). Has a name, and contains
**Modules**. Selected at the start of a survey.

### Module
A phase of work within a Template (e.g. "Installation Phase", "Commissioning
Phase"). Contains **Categories**. Previously called "Space" — the canonical
term is now **Module**. The unrelated **Space** feature reuses that old word
for a different concept; the two are not related.

### Category
A thing being surveyed within a Module (e.g. "Cameras", "Doors"). Contains
**Checklist Items**. The same Category can be copied into more than one Module.

### Checklist Item
A single verification question within a Category (e.g. "Is the camera cable
pulled?", "Is the camera installed?").

### Survey Marker
An area drawn on a PDF in **Survey mode** over a real element of the drawing
(e.g. a door or a camera). Each Survey Marker is assigned exactly one Category
and one Entity, and its data is exported to Excel. It is a selectable shape —
the user can draw, select, move, and resize it. Previously called "Survey
Highlight" or "Highlight" — renamed because the **Base layer** has a separate
plain highlighter tool, and the two should not share a word.

### Tag
A Survey Marker's name: the device's name on the job, such as C-1-01. The same
word is used in Walkthru and Plot (Kal Voe suite), so one device keeps one Tag
in every app. The Excel column still says "Item".

### Suite id
A tracked device's shared id across the Kal Voe suite (Walkthru, Plot,
Survey). A Survey Marker made in Survey takes its own id; a copy or an import
keeps the original's. Excel can never change it.

### Building, Wing, Floor, Location
Where a device is. One PDF set can hold more than one Building; Floor is the
floor a page shows; Location is the room or area the device sits in, as the
plan names it. All four travel with the device between the suite's apps.

### My library / Company library
The Categories and Category Types a person or their company keeps, shared by
Walkthru, Plot and Survey. A Survey Template's Categories link to entries
here. Company library shows once the person is in a company. Any member can
add an entry; only owners and admins can rename or remove one.

### Entity
A responsible party or status (e.g. "GC", "Subcontractor", "100% Complete",
"Removed"). An Entity is assigned to a **Survey Marker** and defines that
marker's color. Entities are defined per Template and chosen in Survey mode.
Previously called "Ball in Court" — the canonical term is now **Entity**.

### Survey mode
The in-app mode where a Template is applied to a PDF. The user is taken through
the Template's Modules, draws **Survey Markers** on the PDF, and assigns each
one a Category and an Entity. The survey panel lists Categories, the Survey
Markers under each Category, and the Checklist Items under each Survey Marker.
Survey mode hides the **Base layer** while it is active.

### Annotation
Lines, clouds, text, pen and the other marks that are not a device. Previously
called "Markup" on screen (the code and stored values still say markup).

### Labels
Words a person sticks on files and marks to sort them. Previously called
"Tags" on screen; renamed because **Tag** now means a device's name.

### Base layer
The default PDF annotation layer — general-purpose annotation on a PDF, comparable
to Adobe Acrobat. Available to all users, including the free tier. The Base
layer and **Survey mode** are mutually exclusive — only one shows at a time.
The **Region** layer can be shown on top of either of them. Every annotation
type (Callouts, Counter Pins, pen, shapes, text, the plain highlighter) can be
used on any layer; only **Survey Markers** are exclusive to Survey mode.

### Text Callout
A floating text box that labels something on the PDF, joined to the thing it
points at by a line with an arrowhead. The line can bend at one point to route
around other content. A standard PDF tool, the same as in Adobe Acrobat or
Drawboard — nothing app-specific. Can be placed on any layer.

### Counter Pin
A small numbered marker dropped on the PDF to count instances of something
(e.g. cameras, doors). Each pin belongs to a **counter series**; within a
series the pins are numbered in the order they were placed, and the whole
series renumbers automatically when a pin is added or removed. A series has
its own color and may start at any number; a document can hold several series
at once. Counting is by plain numbers today — lettered and sub-numbered
styles are planned but not yet built. Can be placed on any layer.

### Counter series
One running count of **Counter Pins** that share a color and a number
sequence. New series are given a distinct color automatically.

### Space
A named grouping of PDF pages (e.g. "TCO1" covering floors 1–5). A Space
contains one **Region** per page it includes. Used to focus document review on
one section of a building at a time. (The word "space" was the original name
for what is now a **Module** — that is unrelated history, not the same thing.)

### Region
A focus mask on a single PDF page. A Region belongs to exactly one **Space**,
with one Region per page in that Space. It dims everything on the page except
the area under review, so that area stands out. Unlike a **Survey Marker**, a
Region is not a free-floating shape — it can only be changed in edit mode.
