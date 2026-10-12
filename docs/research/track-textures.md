# Track surface PBR textures (ambientCG, CC0, 1K JPG)

All license-verified on the asset page (CC0, published by ambientCG, no individual author). All zip URLs return HTTP 200 (application/zip) via redirect; zips for picks were downloaded to /tmp/tt-dl and their file lists read (never executed). Use `NormalGL` for three.js.

| Surface | Id | Zip URL | Preview / page | Size | Notes |
|---|---|---|---|---|---|
| asphalt | Asphalt010 | https://ambientcg.com/get?file=Asphalt010_1K-JPG.zip | https://ambientcg.com/a/Asphalt010 | 8.4 MB | Dark, clean, fine grain, no cracks; slightly blue-grey. Procedural. |
| asphalt alt | Asphalt015 | https://ambientcg.com/get?file=Asphalt015_1K-JPG.zip | https://ambientcg.com/a/Asphalt015 | 8.6 MB | Mid grey photogrammetry; darken via material color (zip contents not listed) |
| grass | Grass005 | https://ambientcg.com/get?file=Grass005_1K-JPG.zip | https://ambientcg.com/a/Grass005 | 10.4 MB | Short clean lawn, saturated green (tone down for realism) |
| gravel | Gravel041 | https://ambientcg.com/get?file=Gravel041_1K-JPG.zip | https://ambientcg.com/a/Gravel041 | 10.2 MB | Fine small stones, grey-beige/olive; tint warmer/lighter via color |
| gravel alt | Gravel043 | https://ambientcg.com/get?file=Gravel043_1K-JPG.zip | https://ambientcg.com/a/Gravel043 | 10.4 MB | Darker grey, finer; too dark for beige. (Gravel023 is lightest but coarse white pebbles) |
| concrete | Concrete030 | https://ambientcg.com/get?file=Concrete030_1K-JPG.zip | https://ambientcg.com/a/Concrete030 | 7.7 MB | Plain grey formwork concrete, good for pit wall/barriers |
| concrete alt | Concrete034 | https://ambientcg.com/get?file=Concrete034_1K-JPG.zip | https://ambientcg.com/a/Concrete034 | 3.7 MB | Light smooth, near white |
| metal (armco, optional) | Metal032 | https://ambientcg.com/get?file=Metal032_1K-JPG.zip | https://ambientcg.com/a/Metal032 | n/a | Matte galvanized grey-blue; has Metalness map |

Thumbnails: https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/<ID>.png

Zip contents (picks): `<ID>_1K-JPG_Color.jpg`, `_NormalGL.jpg`, `_NormalDX.jpg`, `_Roughness.jpg`, `_Displacement.jpg`, plus `_AmbientOcclusion.jpg` (Grass005, Gravel041, Concrete030), `_Opacity.jpg` (Asphalt010, ignore), `_Metalness.jpg` (Metal032), and .usdc/.blend/.mtlx/.tres/preview png (ignore).

Rejected: Asphalt026C (cracked), Asphalt030/031/032/033 (light/beige/brown, not dark race asphalt), Grass001/004 (long/dense, dark), Concrete045 (patterned), Concrete036 (stained/old), Gravel022/026 (coarse multicolor pebbles).

```json
[
 {"id":"Asphalt010","source":"ambientcg","surface":"asphalt","zip":"https://ambientcg.com/get?file=Asphalt010_1K-JPG.zip","files":{"color":"Asphalt010_1K-JPG_Color.jpg","normal":"Asphalt010_1K-JPG_NormalGL.jpg","roughness":"Asphalt010_1K-JPG_Roughness.jpg","displacement":"Asphalt010_1K-JPG_Displacement.jpg"},"license":"CC0","preview":"https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Asphalt010.png"},
 {"id":"Grass005","source":"ambientcg","surface":"grass","zip":"https://ambientcg.com/get?file=Grass005_1K-JPG.zip","files":{"color":"Grass005_1K-JPG_Color.jpg","normal":"Grass005_1K-JPG_NormalGL.jpg","roughness":"Grass005_1K-JPG_Roughness.jpg","ao":"Grass005_1K-JPG_AmbientOcclusion.jpg"},"license":"CC0","preview":"https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Grass005.png"},
 {"id":"Gravel041","source":"ambientcg","surface":"gravel","zip":"https://ambientcg.com/get?file=Gravel041_1K-JPG.zip","files":{"color":"Gravel041_1K-JPG_Color.jpg","normal":"Gravel041_1K-JPG_NormalGL.jpg","roughness":"Gravel041_1K-JPG_Roughness.jpg","ao":"Gravel041_1K-JPG_AmbientOcclusion.jpg"},"license":"CC0","preview":"https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Gravel041.png"},
 {"id":"Concrete030","source":"ambientcg","surface":"concrete","zip":"https://ambientcg.com/get?file=Concrete030_1K-JPG.zip","files":{"color":"Concrete030_1K-JPG_Color.jpg","normal":"Concrete030_1K-JPG_NormalGL.jpg","roughness":"Concrete030_1K-JPG_Roughness.jpg","ao":"Concrete030_1K-JPG_AmbientOcclusion.jpg"},"license":"CC0","preview":"https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Concrete030.png"},
 {"id":"Metal032","source":"ambientcg","surface":"metal","zip":"https://ambientcg.com/get?file=Metal032_1K-JPG.zip","files":{"color":"Metal032_1K-JPG_Color.jpg","normal":"Metal032_1K-JPG_NormalGL.jpg","roughness":"Metal032_1K-JPG_Roughness.jpg","metalness":"Metal032_1K-JPG_Metalness.jpg"},"license":"CC0","preview":"https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Metal032.png"}
]
```
Alts (zip HEAD 200, same naming pattern assumed): Asphalt015, Gravel043, Concrete034.
