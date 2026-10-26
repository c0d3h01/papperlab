# Third-party notices

PaperLab itself is licensed under the Apache License 2.0 (see `LICENSE`).
The following components are included in, or used by, PaperLab. Their licenses
apply to those components, not to PaperLab's own source code.

## Fonts

The web app bundles these fonts under the SIL Open Font License 1.1. The full
license text and copyright notices are in `web/assets/fonts/OFL.txt`.

| Font | Copyright |
| --- | --- |
| Bricolage Grotesque | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) |
| Instrument Sans | Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans) |
| IBM Plex Mono | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |

## PDF.js

`web/vendor/pdfjs/` contains PDF.js 4.10.38 from Mozilla. It is licensed under
the Apache License 2.0; the license header is retained in the vendored files.

- Source: https://github.com/mozilla/pdf.js
- Copyright 2024 Mozilla Foundation

## Go dependencies

PaperLab links the following Go modules. The Apache License 2.0 text is in
`LICENSE`. MIT and BSD-3-Clause texts are reproduced below. To regenerate this
list, run:

```sh
go list -deps -f '{{with .Module}}{{.Path}}{{end}}' ./... | sort -u
```

| Module | License | Copyright |
| --- | --- | --- |
| github.com/chromedp/cdproto | MIT | Copyright (c) 2016-2026 Kenneth Shaw |
| github.com/chromedp/chromedp | MIT | Copyright (c) 2016-2026 Kenneth Shaw |
| github.com/clipperhouse/uax29/v2 | MIT | Copyright (c) 2020 Matt Sherman |
| github.com/gabriel-vasile/mimetype | MIT | Copyright (c) 2018-2020 Gabriel Vasile |
| github.com/gin-contrib/sse | MIT | Copyright (c) 2014 Manuel Martínez-Almeida |
| github.com/gin-gonic/gin | MIT | Copyright (c) 2014 Manuel Martínez-Almeida |
| github.com/go-pdf/fpdf | MIT | Copyright (c) 2021 The Go-PDF authors; 2020 David Barnes; 2017 Kurt Jung and contributors |
| github.com/go-playground/locales | MIT | Copyright (c) 2016 Go Playground |
| github.com/go-playground/universal-translator | MIT | Copyright (c) 2016 Go Playground |
| github.com/go-playground/validator/v10 | MIT | Copyright (c) 2015 Dean Karn |
| github.com/hhrutter/tiff | BSD-3-Clause | Copyright (c) 2009 The Go Authors |
| github.com/leodido/go-urn | MIT | Copyright (c) 2018 Leonardo Di Donato |
| github.com/mattn/go-isatty | MIT | Copyright (c) Yasuhiro MATSUMOTO |
| github.com/mattn/go-runewidth | MIT | Copyright (c) 2016 Yasuhiro Matsumoto |
| github.com/pdfcpu/pdfcpu | Apache-2.0 | Copyright the pdfcpu authors |
| github.com/pelletier/go-toml/v2 | MIT | Copyright (c) 2021-2023 Thomas Pelletier |
| github.com/richardlehane/mscfb | Apache-2.0 | Copyright the mscfb authors |
| github.com/richardlehane/msoleps | Apache-2.0 | Copyright the msoleps authors |
| github.com/sergi/go-diff | MIT | Copyright (c) 2012-2016 The go-diff Authors |
| github.com/tiendc/go-deepcopy | MIT | Copyright (c) 2023 tiendc |
| github.com/ugorji/go/codec | MIT | Copyright (c) 2012-2020 Ugorji Nwoke |
| github.com/xdg-go/stringprep | Apache-2.0 | Copyright the stringprep authors |
| github.com/xuri/efp | BSD-3-Clause | Copyright (c) 2017-2025 Ri Xu |
| github.com/xuri/excelize/v2 | BSD-3-Clause | Copyright (c) 2016-2026 The excelize Authors; 2011-2017 Geoffrey J. Teale |
| github.com/xuri/nfp | BSD-3-Clause | Copyright (c) 2022-2025 Ri Xu |
| go.yaml.in/yaml/v3 | MIT or Apache-2.0 | Copyright the yaml authors |
| golang.org/x/crypto | BSD-3-Clause | Copyright 2009 The Go Authors |
| golang.org/x/image | BSD-3-Clause | Copyright 2009 The Go Authors |
| golang.org/x/net | BSD-3-Clause | Copyright 2009 The Go Authors |
| golang.org/x/sys | BSD-3-Clause | Copyright 2009 The Go Authors |
| golang.org/x/text | BSD-3-Clause | Copyright 2009 The Go Authors |
| google.golang.org/protobuf | BSD-3-Clause | Copyright (c) 2018 The Go Authors |
| gopkg.in/yaml.v3 | MIT or Apache-2.0 | Copyright the yaml authors |

Modules not linked into the server binary are test-only or transitive
dependencies and are not redistributed by PaperLab.

### MIT License

Copyright (c) the copyright holders listed above.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### BSD 3-Clause License

Copyright (c) the copyright holders listed above.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Container runtime packages

The Docker image installs Debian packages and runs them as separate processes.
Publishing that image means distributing these programs too. Their copyright
and license files are included in the image under
`/usr/share/doc/<package>/copyright`.

| Package | License | Source |
| --- | --- | --- |
| Ghostscript | AGPL-3.0 | https://github.com/ArtifexSoftware/ghostscript |
| Poppler | GPL-2.0-or-later | https://gitlab.freedesktop.org/poppler/poppler |
| qpdf | Apache-2.0 | https://github.com/qpdf/qpdf |
| Tesseract | Apache-2.0 | https://github.com/tesseract-ocr/tesseract |
| LibreOffice | MPL-2.0 | https://www.libreoffice.org/about-us/source-code/ |
| Chromium | BSD-3-Clause and third-party licenses | https://chromium.googlesource.com/chromium/src/ |
| Debian base image | Various free-software licenses | https://www.debian.org/legal/licenses/ |
| Debian fonts (`fonts-dejavu-core`, `fonts-liberation`, `fonts-noto-core`) | Permissive / SIL OFL 1.1 | https://www.debian.org/ |

If you distribute a PaperLab image, keep the package license files in the
image and make the corresponding source available as required by those
licenses. Ghostscript's AGPL-3.0 and Poppler's GPL-2.0 are the most important:
do not remove their source/notice obligations when republishing the image.
