# Third-party notices

SEA source and its original four-panel SVG icon are MIT licensed. Course examples and source material are not part of the distributed package and are not covered by that license.

Runtime direct dependencies (their own license files remain authoritative):

| Package | License | Use |
| --- | --- | --- |
| pdfkit | MIT | PDF construction and built-in font metrics |
| svg-to-pdfkit | MIT | MathJax vector formula placement |
| @mathjax/src | Apache-2.0 | TeX-to-vector mathematical layout |
| pdfjs-dist | Apache-2.0 | Bounded PDF text extraction |
| fflate | MIT | Bounded OOXML ZIP extraction |

Transitive packages retain their individual licenses in installed dependencies. Do not remove notices when redistributing a bundled dependency tree. MathJax v4 is pinned and its local New Computer Modern font dependency retains its own license notices. No font files from private examples are redistributed; the PDF renderer uses PDFKit built-in serif/sans metrics and MathJax math paths. The lockfile selects patched @xmldom/xmldom 0.9.12; run production dependency audits when updating the lockfile.
