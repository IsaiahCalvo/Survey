# "Open in Survey" from OneDrive and SharePoint on the web

KAL-703. Drawboard can be the app that opens a PDF in OneDrive and SharePoint
on the web. Survey can be too, through a file handler on Survey's Microsoft
app (Entra app registration, client `0da81a9e-…`).

## Survey's side (built)

- `api/onedrive-open.mjs` takes Microsoft's POST (form field `items`, a JSON
  list of Graph addresses like
  `https://graph.microsoft.com/v1.0/drives/{drive-id}/items/{item-id}`) and
  sends the browser on to `/?open-onedrive={drive-id}&item={item-id}`.
- The home screen opens that file the way "Open from OneDrive" does: linked,
  so marks save back. With no Microsoft connection yet, the OneDrive picker
  opens on its Connect step.
- Behind the Nightly flag `onedrive-file-handler`.

## The admin part (still to do, needs a Kal Voe tenant admin)

1. In the Entra admin center, open Survey's app registration, then Manifest.
2. Add this to `addIns` (a new `id`, any GUID):

```json
{
  "id": "<new GUID>",
  "type": "FileHandler",
  "properties": [
    { "key": "version", "value": "2" },
    { "key": "fileTypeDisplayName", "value": "Survey" },
    { "key": "fileTypeIcon", "value": "{\"svg\":\"https://surveytool.app/favicon.svg\",\"png1x\":\"https://surveytool.app/favicon-64x64.png\"}" },
    { "key": "actions", "value": "[{\"type\":\"open\",\"displayName\":\"Open in Survey\",\"url\":\"https://surveytool.app/api/onedrive-open\",\"availableOn\":{\"file\":{\"extensions\":[\".pdf\"]},\"web\":{}}}]" }
  ]
}
```

3. Save. The app already asks for `Files.ReadWrite.All` (Open from OneDrive),
   which a file handler needs.
4. Each company's admin allows Survey's app in their own tenant once. Then
   "Open in Survey" shows in the Open menu of a PDF in OneDrive and SharePoint.
   Microsoft can take up to a day to show a new handler.

Check against Microsoft's current file handler docs when doing this: the
form field names above are from the v2 file handler format.
