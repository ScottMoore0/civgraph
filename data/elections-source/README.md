# Election Viewer Export Package

Self-contained election results viewer and STV count animation for static websites.  
Extracted from the [NI Votes](https://github.com/ScottMoore0/privaterep) project.

## Quick Start

1. Drop this folder into your project
2. Serve with any static HTTP server (NOT `file://` — `fetch()` needs HTTP)
3. Open `demo.html` to test

```bash
# Example: Python dev server
cd election-viewer-package
python -m http.server 8080
# Then open http://localhost:8080/demo.html
```

## Integration

### 1. Include CSS & JS

```html
<link rel="stylesheet" href="election-viewer-package/css/election-viewer.css">

<script src="election-viewer-package/js/stages2.js"></script>
<script src="election-viewer-package/js/animation_preview.js"></script>
<script src="election-viewer-package/js/animation_preview_manager.js"></script>
<script src="election-viewer-package/js/election_viewer.js"></script>
```

### 2. Initialise

```javascript
ElectionViewer.init({
  dataBasePath: 'election-viewer-package/data'  // path to data/ folder
});
```

### 3. Show Election Results

```javascript
// Show a specific constituency's results
const container = document.getElementById('results-panel');
ElectionViewer.show('Northern Ireland Assembly', '2022-05-05', 'Belfast East', container);

// Show NI-wide aggregated results
ElectionViewer.showNIResults('Northern Ireland Assembly', '2022-05-05', container);
```

### 4. Build a Selector UI

```javascript
const selectorDiv = document.getElementById('selector');
ElectionViewer.buildSelector(selectorDiv, function (body, date, constituency) {
  ElectionViewer.show(body, date, constituency, resultsPanel);
});
```

## Public API

| Method | Description |
|--------|-------------|
| `init(options)` | Initialise with `{ dataBasePath }`. Returns Promise. |
| `show(body, date, constituency, container)` | Render full results into container. Returns Promise. |
| `showNIResults(body, date, container)` | Render NI-wide aggregated party results. Returns Promise. |
| `getIndex()` | Get the elections index. Returns Promise. |
| `buildSelector(container, onSelect)` | Build a body/date/constituency dropdown selector. |
| `loadElection(body, date, constituency)` | Load raw election JSON. Returns Promise. |
| `buildResultsTable(payload)` | Build results table HTML from payload. Returns string. |
| `buildPreviewCard(payload)` | Build preview bar chart HTML from payload. Returns string. |

## Data Format

### `elections_index.json`
```json
{
  "bodies": [
    {
      "name": "Northern Ireland Assembly",
      "slug": "northern-ireland-assembly",
      "dates": [
        {
          "date": "2022-05-05",
          "constituencies": ["Belfast East", "Belfast North", ...]
        }
      ]
    }
  ]
}
```

### Per-election JSON (`elections/{body-slug}/{date}/{constituency-slug}.json`)
```json
{
  "Constituency": {
    "countGroup": [
      {
        "Candidate_Id": "51102",
        "candidateName": "Naomi Long",
        "Party_Name": "Alliance",
        "Party_Colour": "#F6CB2F",
        "Count_Number": "1",
        "Total_Votes": "8195.00",
        "Transfers": "0.00",
        "Candidate_First_Pref_Votes": "8195",
        "Status": "Elected",
        "Occurred_On_Count": "1"
      }
      // ... one entry per candidate per count
    ],
    "countInfo": {
      "Constituency_Name": "Belfast East",
      "Number_Of_Seats": "5",
      "Quota": "7209",
      "Total_Electorate": "70123",
      "Total_Poll": "43840",
      "Valid_Poll": "43248",
      "Spoiled": "592"
    }
  }
}
```

## Files

```
election-viewer-package/
├── README.md                          # This file
├── demo.html                          # Standalone test page
├── css/
│   ├── election-viewer.css            # All styles (consolidated)
│   └── stages.css                     # Original animation CSS (reference)
├── js/
│   ├── stages2.js                     # STV animation engine (3308 lines)
│   ├── animation_preview.js           # Static preview renderer
│   ├── animation_preview_manager.js   # Preview lifecycle manager
│   └── election_viewer.js             # Main integration module
└── data/
    ├── elections_index.json           # Master election index
    └── elections/                     # Per-election JSON files
        ├── northern-ireland-assembly/
        ├── house-of-commons-.../
        ├── european-parliament/
        ├── northern-ireland-forum-.../
        └── northern-ireland-constitutional-.../
```

## Elected Bodies Included

| Body | Elections |
|------|-----------|
| Northern Ireland Assembly | Multiple dates |
| House of Commons (Westminster NI) | Multiple dates |
| European Parliament | Multiple dates |
| NI Forum for Political Dialogue | 1996 |
| NI Constitutional Convention | 1975 |

## Licence

STV animation engine (`stages2.js`) is licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) by James Bligh (@anamates).
