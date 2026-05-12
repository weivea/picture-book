# EPUB3 Media Overlays 速查

## 文件结构（OEBPS/ 内）

```
OEBPS/
├── content.opf
├── nav.xhtml
├── page-0.xhtml ~ page-N.xhtml
├── images/0.png ~ N.png
├── audio/0.mp3 ~ N.mp3
└── smil/page-0.smil ~ page-N.smil
```

## SMIL 文件示例

```xml
<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL"
      xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq1" epub:textref="../page-1.xhtml" epub:type="bodymatter chapter">
      <par id="par1-1">
        <text src="../page-1.xhtml#p1-s1"/>
        <audio src="../audio/1.mp3" clipBegin="0ms" clipEnd="1880ms"/>
      </par>
    </seq>
  </body>
</smil>
```

## content.opf 关键字段

```xml
<metadata>
  <meta property="media:duration" refines="#smil-1">PT4.820S</meta>
  <meta property="media:duration">PT58.300S</meta>
  <meta property="media:active-class">-epub-media-overlay-active</meta>
  <meta property="media:narrator">zh-CN-XiaoyiNeural</meta>
</metadata>

<manifest>
  <item id="page-1"  href="page-1.xhtml"     media-type="application/xhtml+xml"
        media-overlay="smil-1"/>
  <item id="audio-1" href="audio/1.mp3"      media-type="audio/mpeg"/>
  <item id="smil-1"  href="smil/page-1.smil" media-type="application/smil+xml"/>
</manifest>
```

## ISO 8601 PT 时长格式

毫秒转换：`5230 ms` → `PT5.230S`，`62500 ms` → `PT62.500S`

## XHTML 高亮锚点

每个可朗读句包成可寻址 span：

```html
<p class="caption">
  <span id="p1-s1">毛毛在外婆家过暑假。</span>
  <span id="p1-s2">每天有讲不完的故事。</span>
</p>
```

CSS 中 `-epub-media-overlay-active` 类会在朗读到对应句时自动激活。
