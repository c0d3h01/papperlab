/*
 * PaperLab tool catalog.
 *
 * This file is the single source of truth for the marketing site, catalog,
 * dynamic tool forms, and the studio hand-offs. Every field name maps directly
 * to the options object accepted by the Go API.
 */

export const GROUPS = [
  {
    id: "organize",
    name: "Organize",
    label: "01 / Arrange",
    blurb: "Put pages in their place. Combine, split, reorder and impose.",
    accent: "blue",
  },
  {
    id: "optimize",
    name: "Optimize",
    label: "02 / Refine",
    blurb: "Slim files down, rebuild damage, make scans searchable.",
    accent: "yellow",
  },
  {
    id: "convert",
    name: "Convert",
    label: "03 / Transform",
    blurb: "Move cleanly between PDF, Office, images and the web.",
    accent: "magenta",
  },
  {
    id: "edit",
    name: "Edit",
    label: "04 / Mark up",
    blurb: "Write on pages, number them, stamp them, sign them.",
    accent: "orange",
  },
  {
    id: "security",
    name: "Secure",
    label: "05 / Protect",
    blurb: "Lock documents, black out secrets, compare revisions.",
    accent: "ink",
  },
  {
    id: "forms",
    name: "Forms",
    label: "06 / Fill",
    blurb: "Read, fill and export AcroForm fields without a printer.",
    accent: "teal",
  },
  {
    id: "ai",
    name: "Read & ask",
    label: "07 / Understand",
    blurb: "Summaries, translation and grounded answers with sources.",
    accent: "violet",
  },
];

export const GROUP_MAP = Object.fromEntries(GROUPS.map((g) => [g.id, g]));

const PDF_ACCEPT = ".pdf,application/pdf";
const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.bmp,image/*";
const WORD_ACCEPT =
  ".docx,.doc,.rtf,.odt,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf";
const SLIDE_ACCEPT =
  ".pptx,.ppt,.odp,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SHEET_ACCEPT =
  ".xlsx,.xls,.csv,.ods,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const HTML_ACCEPT = ".html,.htm,text/html";

const passwordField = {
  key: "password",
  label: "Document password",
  type: "password",
  placeholder: "Only if the PDF is locked",
  help: "Used to open an encrypted file. It is never stored.",
  advanced: true,
  width: "half",
};

const pagesField = (help = "All pages unless you narrow the range.") => ({
  key: "pages",
  label: "Pages",
  type: "pages",
  placeholder: "All pages",
  help,
  width: "full",
});

const POSITIONS = [
  { value: "tl", label: "Top left" },
  { value: "tc", label: "Top center" },
  { value: "tr", label: "Top right" },
  { value: "l", label: "Middle left" },
  { value: "c", label: "Center" },
  { value: "r", label: "Middle right" },
  { value: "bl", label: "Bottom left" },
  { value: "bc", label: "Bottom center" },
  { value: "br", label: "Bottom right" },
];

const FONTS = [
  { value: "Helvetica", label: "Helvetica" },
  { value: "Times-Roman", label: "Times" },
  { value: "Courier", label: "Courier" },
];

const PAPER = [
  { value: "A4P", label: "A4 portrait" },
  { value: "A4L", label: "A4 landscape" },
  { value: "LetterP", label: "Letter portrait" },
  { value: "LetterL", label: "Letter landscape" },
  { value: "LegalP", label: "Legal portrait" },
];

const IMAGE_PAGE_SIZES = [
  { value: "fit", label: "Fit to image" },
  { value: "a4", label: "A4" },
  { value: "letter", label: "Letter" },
  { value: "a3", label: "A3" },
];

const ORIENTATIONS = [
  { value: "auto", label: "Auto" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

const QUALITY_LEVELS = [
  { value: "light", label: "Light", hint: "Printer quality" },
  { value: "balanced", label: "Balanced", hint: "Recommended" },
  { value: "high", label: "Strong", hint: "Ebook quality" },
  { value: "extreme", label: "Extreme", hint: "Smallest file" },
];

const LANGUAGES = [
  { value: "auto", label: "Detect automatically" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "hi", label: "Hindi" },
  { value: "mr", label: "Marathi" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "ar", label: "Arabic" },
  { value: "ru", label: "Russian" },
  { value: "tr", label: "Turkish" },
];

const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.value !== "auto");

function tool(config) {
  return {
    multiple: false,
    minFiles: 1,
    maxFiles: 1,
    allowNoInput: false,
    fields: [],
    keywords: [],
    outputs: [],
    ...config,
  };
}

export const TOOLS = [
  /* ------------------------------------------------------------------ */
  /* Organize                                                            */
  /* ------------------------------------------------------------------ */
  tool({
    id: "merge",
    name: "Merge PDF",
    short: "Merge",
    group: "organize",
    icon: "merge",
    tagline: "Combine documents without losing a page.",
    description:
      "Drop two or more PDFs in the order you want them. PaperLab stitches them into one clean document and adds a bookmark for each source file.",
    accept: PDF_ACCEPT,
    multiple: true,
    minFiles: 2,
    maxFiles: 20,
    popular: true,
    keywords: ["combine", "join", "append", "concatenate"],
    fields: [
      {
        key: "addBookmarks",
        label: "Add file bookmarks",
        type: "toggle",
        default: true,
        help: "Create a navigable bookmark for each source document.",
      },
      passwordField,
    ],
    outputs: ["One merged PDF"],
    tips: ["Drag files in the list order you want them to appear."],
  }),
  tool({
    id: "split",
    name: "Split PDF",
    short: "Split",
    group: "organize",
    icon: "split",
    tagline: "One document in, exactly the parts you need out.",
    description:
      "Break a PDF into ranges, single pages, fixed-size chunks, or top-level bookmarks. Multi-part results arrive with a ZIP for one-click download.",
    accept: PDF_ACCEPT,
    popular: true,
    keywords: ["separate", "divide", "extract", "chunks", "ranges"],
    fields: [
      {
        key: "mode",
        label: "Split by",
        type: "segment",
        default: "ranges",
        options: [
          { value: "ranges", label: "Page ranges" },
          { value: "each", label: "Every page" },
          { value: "every", label: "Every N pages" },
          { value: "bookmarks", label: "Bookmarks" },
        ],
      },
      {
        key: "ranges",
        label: "Ranges",
        type: "text",
        default: "1-2, 3",
        placeholder: "1-3, 5, 8-10",
        help: "Comma-separated page numbers or ranges. Each range becomes a file.",
        when: { key: "mode", equals: "ranges" },
        required: true,
      },
      {
        key: "every",
        label: "Pages per file",
        type: "number",
        default: 2,
        min: 1,
        max: 500,
        when: { key: "mode", equals: "every" },
      },
      passwordField,
    ],
    outputs: ["Separate PDFs", "ZIP archive when there is more than one part"],
  }),
  tool({
    id: "remove-pages",
    name: "Remove pages",
    short: "Remove",
    group: "organize",
    icon: "remove",
    tagline: "Take out what does not belong.",
    description:
      "Name the pages to delete and PaperLab rebuilds the document around them. Everything else stays exactly where it was.",
    accept: PDF_ACCEPT,
    keywords: ["delete", "drop", "pages", "trim"],
    fields: [
      {
        ...pagesField("Pages to delete. Use commas for lists and dashes for ranges."),
        required: true,
        placeholder: "e.g. 2, 5-7",
      },
      passwordField,
    ],
    outputs: ["Edited PDF"],
  }),
  tool({
    id: "extract-pages",
    name: "Extract pages",
    short: "Extract",
    group: "organize",
    icon: "extract",
    tagline: "Pull out the pages worth keeping.",
    description:
      "Choose pages and receive a new PDF containing only those pages, in the same order. The original file is untouched.",
    accept: PDF_ACCEPT,
    keywords: ["pull", "select", "subset", "copy pages"],
    fields: [pagesField("Pages to keep. Leave empty to copy the whole document."), passwordField],
    outputs: ["New PDF with the selected pages"],
  }),
  tool({
    id: "organize",
    name: "Organize PDF",
    short: "Organize",
    group: "organize",
    icon: "organize",
    tagline: "A contact sheet for your pages.",
    description:
      "See every page at once. Drag to reorder, rotate, duplicate or delete, then export a rebuilt document in one pass.",
    accept: PDF_ACCEPT,
    studio: "organize",
    popular: true,
    keywords: ["reorder", "sort", "arrange", "move pages", "duplicate"],
    outputs: ["Rebuilt PDF"],
  }),
  tool({
    id: "rotate",
    name: "Rotate PDF",
    short: "Rotate",
    group: "organize",
    icon: "rotate",
    tagline: "Turn sideways scans the right way up.",
    description:
      "Rotate every page or just the ones that need it. Choose 90, 180 or 270 degrees clockwise.",
    accept: PDF_ACCEPT,
    keywords: ["turn", "orientation", "landscape", "portrait", "sideways"],
    fields: [
      {
        key: "angle",
        label: "Rotation",
        type: "segment",
        default: 90,
        options: [
          { value: 90, label: "90° right" },
          { value: 180, label: "180°" },
          { value: 270, label: "90° left" },
        ],
      },
      pagesField("Which pages should turn? Leave empty for all."),
      passwordField,
    ],
    outputs: ["Rotated PDF"],
  }),
  tool({
    id: "crop",
    name: "Crop PDF",
    short: "Crop",
    group: "organize",
    icon: "crop",
    tagline: "Trim margins, keep the content.",
    description:
      "Cut equal margins from every edge, or open the visual cropper to draw an exact region. The page box is changed without re-rendering text.",
    accept: PDF_ACCEPT,
    visual: "crop",
    keywords: ["trim", "margins", "cut", "white space"],
    fields: [
      {
        key: "top",
        label: "Top",
        type: "number",
        default: 5,
        min: 0,
        max: 45,
        step: 0.5,
        suffix: "%",
        width: "half",
      },
      {
        key: "bottom",
        label: "Bottom",
        type: "number",
        default: 5,
        min: 0,
        max: 45,
        step: 0.5,
        suffix: "%",
        width: "half",
      },
      {
        key: "left",
        label: "Left",
        type: "number",
        default: 5,
        min: 0,
        max: 45,
        step: 0.5,
        suffix: "%",
        width: "half",
      },
      {
        key: "right",
        label: "Right",
        type: "number",
        default: 5,
        min: 0,
        max: 45,
        step: 0.5,
        suffix: "%",
        width: "half",
      },
      passwordField,
    ],
    outputs: ["Cropped PDF"],
  }),
  tool({
    id: "n-up",
    name: "N-up PDF",
    short: "N-up",
    group: "organize",
    icon: "nup",
    tagline: "Many pages, fewer sheets.",
    description:
      "Place 2, 4, 6, 9 or 16 pages on each sheet. Ideal for handouts, proof sheets and saving paper.",
    accept: PDF_ACCEPT,
    keywords: ["impose", "multiple pages", "handout", "2-up", "4-up", "print"],
    fields: [
      {
        key: "perSheet",
        label: "Pages per sheet",
        type: "segment",
        default: 2,
        options: [2, 4, 6, 9, 16].map((n) => ({ value: n, label: `${n}-up` })),
      },
      {
        key: "paper",
        label: "Sheet size",
        type: "select",
        default: "A4P",
        options: PAPER,
        width: "half",
      },
      {
        key: "margin",
        label: "Gutter",
        type: "number",
        default: 10,
        min: 0,
        max: 40,
        suffix: "pt",
        width: "half",
      },
      { key: "border", label: "Draw cell borders", type: "toggle", default: false },
      pagesField(),
      passwordField,
    ],
    outputs: ["Imposed PDF"],
  }),
  tool({
    id: "booklet",
    name: "PDF Booklet",
    short: "Booklet",
    group: "organize",
    icon: "booklet",
    tagline: "Print-ready folded booklets.",
    description:
      "Impose pages in booklet order so a stack of sheets folds into a zine, programme or small book. Long-edge and short-edge binding supported.",
    accept: PDF_ACCEPT,
    keywords: ["impose", "zine", "fold", "saddle stitch", "print"],
    fields: [
      {
        key: "binding",
        label: "Binding",
        type: "segment",
        default: "long",
        options: [
          { value: "long", label: "Long edge" },
          { value: "short", label: "Short edge" },
        ],
      },
      { key: "paper", label: "Sheet size", type: "select", default: "A4P", options: PAPER, width: "half" },
      {
        key: "margin",
        label: "Gutter",
        type: "number",
        default: 0,
        min: 0,
        max: 30,
        suffix: "pt",
        width: "half",
      },
      { key: "guides", label: "Add fold guides", type: "toggle", default: false },
      passwordField,
    ],
    outputs: ["Booklet-imposed PDF"],
  }),

  /* ------------------------------------------------------------------ */
  /* Optimize                                                            */
  /* ------------------------------------------------------------------ */
  tool({
    id: "compress",
    name: "Compress PDF",
    short: "Compress",
    group: "optimize",
    icon: "compress",
    tagline: "Smaller files that still look right.",
    description:
      "Recompress images, subset fonts and rebuild object streams with Ghostscript. Pick a level based on where the file is going.",
    accept: PDF_ACCEPT,
    popular: true,
    keywords: ["shrink", "reduce size", "optimize", "email", "smaller"],
    fields: [
      {
        key: "level",
        label: "Compression level",
        type: "cards",
        default: "balanced",
        options: QUALITY_LEVELS,
        help: "Stronger compression can soften photographs and fine line art.",
      },
      passwordField,
    ],
    outputs: ["Compressed PDF", "Compression report in the result details"],
  }),
  tool({
    id: "repair",
    name: "Repair PDF",
    short: "Repair",
    group: "optimize",
    icon: "repair",
    tagline: "Rescue a file that will not open.",
    description:
      "Rebuild broken cross-reference tables and damaged object streams with qpdf, Ghostscript and pdfcpu. PaperLab reports which recovery path worked.",
    accept: PDF_ACCEPT,
    keywords: ["fix", "corrupt", "damaged", "recover", "broken"],
    fields: [passwordField],
    outputs: ["Recovered PDF", "Recovery notes"],
  }),
  tool({
    id: "ocr",
    name: "OCR PDF",
    short: "OCR",
    group: "optimize",
    icon: "ocr",
    tagline: "Turn scans into searchable text.",
    description:
      "Render every page and run Tesseract OCR, then rebuild a PDF with an invisible text layer. Search, copy and ask questions afterwards.",
    accept: PDF_ACCEPT,
    popular: true,
    keywords: ["scan", "searchable", "text layer", "tesseract", "recognize"],
    fields: [
      {
        key: "language",
        label: "Document language",
        type: "select",
        default: "eng",
        dynamic: "ocrLanguages",
        options: [{ value: "eng", label: "English" }],
        width: "half",
        help: "Only languages installed on the server are listed.",
      },
      {
        key: "dpi",
        label: "Render quality",
        type: "select",
        default: 300,
        options: [
          { value: 150, label: "150 dpi · fast" },
          { value: 200, label: "200 dpi" },
          { value: 300, label: "300 dpi · recommended" },
          { value: 400, label: "400 dpi · small print" },
        ],
        width: "half",
      },
      {
        key: "psm",
        label: "Page layout",
        type: "select",
        default: "3",
        options: [
          { value: "3", label: "Automatic" },
          { value: "1", label: "Single block of text" },
          { value: "4", label: "Columns of text" },
          { value: "6", label: "Single uniform block" },
          { value: "11", label: "Sparse text" },
          { value: "12", label: "Sparse text with orientation" },
        ],
        advanced: true,
      },
      { key: "alsoText", label: "Also export a plain-text file", type: "toggle", default: false },
      passwordField,
    ],
    outputs: ["Searchable PDF", "Optional .txt transcript"],
    notes: "OCR runs on the whole document and is limited to 200 pages per job.",
  }),
  tool({
    id: "pdfa",
    name: "PDF to PDF/A",
    short: "PDF/A",
    group: "optimize",
    icon: "pdfa",
    tagline: "An archival copy built to last.",
    description:
      "Convert to PDF/A-2b with an embedded ICC colour profile, making the document self-contained for long-term archiving.",
    accept: PDF_ACCEPT,
    keywords: ["archive", "long term", "compliance", "iso", "preservation"],
    fields: [passwordField],
    outputs: ["PDF/A-2b document"],
  }),
  tool({
    id: "flatten",
    name: "Flatten PDF",
    short: "Flatten",
    group: "optimize",
    icon: "flatten",
    tagline: "Freeze the page exactly as it looks.",
    description:
      "Rasterise every page at high resolution so forms, annotations and transparency are baked in. Nothing can shift on another machine.",
    accept: PDF_ACCEPT,
    keywords: ["rasterize", "freeze", "annotations", "forms", "print"],
    fields: [
      {
        key: "dpi",
        label: "Resolution",
        type: "select",
        default: 200,
        options: [
          { value: 150, label: "150 dpi · screen" },
          { value: 200, label: "200 dpi · balanced" },
          { value: 300, label: "300 dpi · print" },
          { value: 400, label: "400 dpi · archive" },
        ],
      },
      passwordField,
    ],
    outputs: ["Flattened PDF"],
    notes: "Text becomes an image, so the output is no longer searchable. Keep the original.",
  }),

  /* ------------------------------------------------------------------ */
  /* Convert                                                             */
  /* ------------------------------------------------------------------ */
  tool({
    id: "jpg-to-pdf",
    name: "Image to PDF",
    short: "Image → PDF",
    group: "convert",
    icon: "image",
    tagline: "Photos and scans into one document.",
    description:
      "Combine JPG, PNG, WebP, GIF, TIFF or BMP files into a PDF. Each image becomes a page, centred and scaled without distortion.",
    accept: IMAGE_ACCEPT,
    multiple: true,
    minFiles: 1,
    maxFiles: 50,
    popular: true,
    keywords: ["jpg", "jpeg", "png", "photo", "picture", "image"],
    fields: [
      {
        key: "pageSize",
        label: "Page size",
        type: "select",
        default: "fit",
        options: IMAGE_PAGE_SIZES,
        width: "half",
      },
      {
        key: "orientation",
        label: "Orientation",
        type: "select",
        default: "auto",
        options: ORIENTATIONS,
        width: "half",
        when: { key: "pageSize", notEquals: "fit" },
      },
      {
        key: "margin",
        label: "Margin",
        type: "number",
        default: 0,
        min: 0,
        max: 100,
        suffix: "pt",
        width: "half",
      },
      {
        key: "dpi",
        label: "Source DPI",
        type: "number",
        default: 96,
        min: 48,
        max: 600,
        help: "Used to size pages when “Fit to image” is selected.",
        width: "half",
        advanced: true,
      },
    ],
    outputs: ["PDF with one image per page"],
  }),
  tool({
    id: "scan-to-pdf",
    name: "Scan to PDF",
    short: "Scan → PDF",
    group: "convert",
    icon: "scan",
    tagline: "Clean up phone photos of paper.",
    description:
      "Convert photographed pages to a tidy PDF, with optional greyscale and contrast correction to make text stand out.",
    accept: IMAGE_ACCEPT,
    multiple: true,
    maxFiles: 50,
    keywords: ["camera", "phone", "document scanner", "photo", "grayscale"],
    fields: [
      { key: "grayscale", label: "Convert to greyscale", type: "toggle", default: true },
      {
        key: "contrast",
        label: "Contrast",
        type: "range",
        default: 1.15,
        min: 0.5,
        max: 2.5,
        step: 0.05,
        when: { key: "grayscale", equals: true },
      },
      { key: "pageSize", label: "Page size", type: "select", default: "a4", options: IMAGE_PAGE_SIZES, width: "half" },
      { key: "orientation", label: "Orientation", type: "select", default: "auto", options: ORIENTATIONS, width: "half" },
      { key: "margin", label: "Margin", type: "number", default: 0, min: 0, max: 100, suffix: "pt", width: "half" },
      { key: "dpi", label: "Source DPI", type: "number", default: 96, min: 48, max: 600, width: "half", advanced: true },
    ],
    outputs: ["Cleaned scan PDF"],
  }),
  tool({
    id: "word-to-pdf",
    name: "Word to PDF",
    short: "Word → PDF",
    group: "convert",
    icon: "word",
    tagline: "DOCX in, polished PDF out.",
    description:
      "Convert Word documents to PDF. When LibreOffice is available it preserves layout precisely; otherwise PaperLab uses its native DOCX reader.",
    accept: WORD_ACCEPT,
    keywords: ["docx", "doc", "word", "rtf", "odt", "office"],
    fields: [],
    outputs: ["PDF"],
  }),
  tool({
    id: "powerpoint-to-pdf",
    name: "PowerPoint to PDF",
    short: "Slides → PDF",
    group: "convert",
    icon: "powerpoint",
    tagline: "Slides that travel well.",
    description:
      "Turn PPTX, PPT or ODP presentations into a PDF. Native fallback rendering keeps text, images and speaker-friendly spacing intact.",
    accept: SLIDE_ACCEPT,
    keywords: ["pptx", "ppt", "slides", "presentation", "odp", "office"],
    fields: [],
    outputs: ["PDF"],
  }),
  tool({
    id: "excel-to-pdf",
    name: "Excel to PDF",
    short: "Excel → PDF",
    group: "convert",
    icon: "excel",
    tagline: "Spreadsheets without the scroll.",
    description:
      "Convert XLSX, XLS, CSV or ODS workbooks to paginated PDF. Native table rendering handles wide sheets and multiple tabs.",
    accept: SHEET_ACCEPT,
    keywords: ["xlsx", "xls", "csv", "ods", "spreadsheet", "office"],
    fields: [],
    outputs: ["PDF"],
  }),
  tool({
    id: "html-to-pdf",
    name: "HTML to PDF",
    short: "Web → PDF",
    group: "convert",
    icon: "html",
    tagline: "Capture a page, keep the layout.",
    description:
      "Render a live URL or an uploaded HTML file with headless Chrome. Backgrounds, web fonts and modern CSS are preserved.",
    accept: HTML_ACCEPT,
    allowNoInput: true,
    keywords: ["url", "website", "webpage", "chrome", "html"],
    fields: [
      {
        key: "url",
        label: "Web address",
        type: "url",
        placeholder: "https://example.com/article",
        help: "Leave empty if you uploaded an HTML file instead.",
        width: "full",
      },
      { key: "paper", label: "Paper", type: "select", default: "a4", options: [
        { value: "a4", label: "A4" },
        { value: "letter", label: "Letter" },
        { value: "a3", label: "A3" },
        { value: "a5", label: "A5" },
      ], width: "half" },
      { key: "margin", label: "Margin", type: "number", default: 12, min: 0, max: 50, suffix: "mm", width: "half" },
      { key: "scale", label: "Scale", type: "range", default: 1, min: 0.5, max: 2, step: 0.05 },
      { key: "landscape", label: "Landscape", type: "toggle", default: false, width: "half" },
      { key: "background", label: "Print backgrounds", type: "toggle", default: true, width: "half" },
    ],
    outputs: ["PDF snapshot"],
  }),
  tool({
    id: "pdf-to-jpg",
    name: "PDF to image",
    short: "PDF → Image",
    group: "convert",
    icon: "jpg",
    tagline: "Every page as a sharp image.",
    description:
      "Export pages as JPG or PNG at up to 400 dpi. One page returns a single image; several pages return a ZIP.",
    accept: PDF_ACCEPT,
    popular: true,
    keywords: ["jpg", "jpeg", "png", "image", "export", "render"],
    fields: [
      {
        key: "format",
        label: "Format",
        type: "segment",
        default: "jpg",
        options: [
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
        ],
      },
      {
        key: "dpi",
        label: "Resolution",
        type: "select",
        default: 150,
        options: [
          { value: 72, label: "72 dpi · screen" },
          { value: 150, label: "150 dpi · balanced" },
          { value: 300, label: "300 dpi · print" },
          { value: 400, label: "400 dpi · maximum" },
        ],
        width: "half",
      },
      {
        key: "quality",
        label: "JPG quality",
        type: "range",
        default: 88,
        min: 40,
        max: 100,
        step: 1,
        when: { key: "format", equals: "jpg" },
        width: "half",
      },
      pagesField(),
      passwordField,
    ],
    outputs: ["JPG or PNG image", "ZIP for multiple pages"],
  }),
  tool({
    id: "pdf-to-word",
    name: "PDF to Word",
    short: "PDF → Word",
    group: "convert",
    icon: "word",
    tagline: "An editable DOCX from any PDF.",
    description:
      "Extract headings, paragraphs and page structure into a Word document you can edit. Best results come from PDFs with a text layer.",
    accept: PDF_ACCEPT,
    popular: true,
    keywords: ["docx", "word", "editable", "convert", "text"],
    fields: [passwordField],
    outputs: ["DOCX"],
  }),
  tool({
    id: "pdf-to-powerpoint",
    name: "PDF to PowerPoint",
    short: "PDF → Slides",
    group: "convert",
    icon: "powerpoint",
    tagline: "Pages become a slide deck.",
    description:
      "Render each page as a slide image and carry the first lines of text across as slide notes and bullets. Great for turning reports into presentations.",
    accept: PDF_ACCEPT,
    keywords: ["pptx", "powerpoint", "slides", "presentation", "deck"],
    fields: [
      {
        key: "dpi",
        label: "Slide resolution",
        type: "select",
        default: 120,
        options: [
          { value: 96, label: "96 dpi · small file" },
          { value: 120, label: "120 dpi · balanced" },
          { value: 200, label: "200 dpi · sharp" },
        ],
      },
      passwordField,
    ],
    outputs: ["PPTX"],
  }),
  tool({
    id: "pdf-to-excel",
    name: "PDF to Excel",
    short: "PDF → Excel",
    group: "convert",
    icon: "excel",
    tagline: "Tables out of a locked-up layout.",
    description:
      "Detect columns from whitespace and turn every page into a worksheet. Numbers and labels land in separate cells, ready to sort.",
    accept: PDF_ACCEPT,
    keywords: ["xlsx", "excel", "spreadsheet", "table", "data", "csv"],
    fields: [passwordField],
    outputs: ["XLSX"],
  }),
  tool({
    id: "pdf-to-text",
    name: "PDF to text",
    short: "PDF → Text",
    group: "convert",
    icon: "text",
    tagline: "Just the words, in order.",
    description:
      "Extract a clean, layout-aware text transcript from the whole document. Useful for notes, indexing and downstream scripts.",
    accept: PDF_ACCEPT,
    keywords: ["txt", "plain text", "extract", "copy", "content"],
    fields: [passwordField],
    outputs: ["TXT"],
  }),
  tool({
    id: "pdf-to-markdown",
    name: "PDF to Markdown",
    short: "PDF → MD",
    group: "convert",
    icon: "markdown",
    tagline: "Content ready for docs and wikis.",
    description:
      "Turn headings, lists and paragraphs into Markdown with page breaks preserved. Ideal for moving a report into a knowledge base.",
    accept: PDF_ACCEPT,
    keywords: ["md", "markdown", "docs", "wiki", "notes"],
    fields: [passwordField],
    outputs: ["Markdown file"],
  }),
  tool({
    id: "extract-images",
    name: "Extract images",
    short: "Extract images",
    group: "convert",
    icon: "images",
    tagline: "Recover the pictures inside a PDF.",
    description:
      "Pull every embedded raster image out of a document. A single image is returned directly; several arrive in a tidy ZIP.",
    accept: PDF_ACCEPT,
    keywords: ["photos", "pictures", "embedded", "media", "export"],
    fields: [pagesField(), passwordField],
    outputs: ["Images", "ZIP for multiple images"],
  }),

  /* ------------------------------------------------------------------ */
  /* Edit                                                                */
  /* ------------------------------------------------------------------ */
  tool({
    id: "page-numbers",
    name: "Page numbers",
    short: "Numbers",
    group: "edit",
    icon: "numbers",
    tagline: "Pagination with a quiet, precise hand.",
    description:
      "Add page numbers with control over format, starting number, position, font, size and opacity. Skip the cover if you like.",
    accept: PDF_ACCEPT,
    keywords: ["pagination", "numbering", "footer", "header", "pages"],
    fields: [
      {
        key: "format",
        label: "Format",
        type: "select",
        default: "n",
        options: [
          { value: "n", label: "1" },
          { value: "n-of-total", label: "1 / 12" },
          { value: "page-n-of-total", label: "Page 1 of 12" },
        ],
        width: "half",
      },
      { key: "start", label: "Start at", type: "number", default: 1, min: 1, max: 9999, width: "half" },
      { key: "position", label: "Position", type: "select", default: "bc", options: POSITIONS, width: "half" },
      { key: "font", label: "Font", type: "select", default: "Helvetica", options: FONTS, width: "half" },
      { key: "fontSize", label: "Size", type: "number", default: 11, min: 6, max: 72, suffix: "pt", width: "half" },
      { key: "color", label: "Colour", type: "color", default: "#333333", width: "half" },
      { key: "opacity", label: "Opacity", type: "range", default: 1, min: 0.1, max: 1, step: 0.05 },
      { key: "offsetX", label: "Nudge X", type: "number", default: 0, min: -200, max: 200, suffix: "pt", width: "half", advanced: true },
      { key: "offsetY", label: "Nudge Y", type: "number", default: 24, min: -200, max: 200, suffix: "pt", width: "half", advanced: true },
      { key: "skipFirst", label: "Skip the first page", type: "toggle", default: false },
      pagesField(),
      passwordField,
    ],
    outputs: ["Numbered PDF"],
  }),
  tool({
    id: "watermark",
    name: "Watermark",
    short: "Watermark",
    group: "edit",
    icon: "watermark",
    tagline: "Mark every page as yours.",
    description:
      "Stamp text or an image across a document with precise position, opacity, rotation and scale. Apply to all pages or a selection.",
    accept: PDF_ACCEPT,
    popular: true,
    keywords: ["stamp", "draft", "confidential", "logo", "brand"],
    fields: [
      {
        key: "kind",
        label: "Watermark type",
        type: "segment",
        default: "text",
        options: [
          { value: "text", label: "Text" },
          { value: "image", label: "Image" },
        ],
      },
      {
        key: "text",
        label: "Watermark text",
        type: "text",
        default: "CONFIDENTIAL",
        placeholder: "CONFIDENTIAL",
        when: { key: "kind", equals: "text" },
        required: true,
      },
      {
        key: "image",
        label: "Watermark image",
        type: "asset",
        accept: "image/png,image/jpeg,image/webp",
        help: "PNG with transparency works best.",
        when: { key: "kind", equals: "image" },
      },
      { key: "position", label: "Position", type: "select", default: "c", options: POSITIONS, width: "half" },
      { key: "color", label: "Colour", type: "color", default: "#ff5c35", width: "half", when: { key: "kind", equals: "text" } },
      { key: "fontSize", label: "Font size", type: "number", default: 48, min: 8, max: 200, suffix: "pt", width: "half", when: { key: "kind", equals: "text" } },
      { key: "font", label: "Font", type: "select", default: "Helvetica", options: FONTS, width: "half", when: { key: "kind", equals: "text" } },
      { key: "opacity", label: "Opacity", type: "range", default: 0.25, min: 0.05, max: 1, step: 0.05 },
      { key: "rotation", label: "Rotation", type: "range", default: 45, min: -180, max: 180, step: 1, when: { key: "kind", equals: "text" }, help: "Ignored when the diagonal option is on." },
      { key: "diagonal", label: "Diagonal across the page", type: "toggle", default: true, when: { key: "kind", equals: "text" } },
      { key: "scale", label: "Image scale", type: "range", default: 0.25, min: 0.05, max: 1, step: 0.05, when: { key: "kind", equals: "image" } },
      { key: "offsetX", label: "Nudge X", type: "number", default: 0, min: -300, max: 300, suffix: "pt", width: "half", advanced: true },
      { key: "offsetY", label: "Nudge Y", type: "number", default: 0, min: -300, max: 300, suffix: "pt", width: "half", advanced: true },
      pagesField(),
      passwordField,
    ],
    outputs: ["Watermarked PDF"],
  }),
  tool({
    id: "edit",
    name: "Edit PDF",
    short: "Edit",
    group: "edit",
    icon: "edit",
    tagline: "Type, draw and annotate on the page.",
    description:
      "Open the visual editor to add text, rectangles, highlights, ellipses, lines, freehand ink, images and signatures. Every mark is baked into the exported PDF.",
    accept: PDF_ACCEPT,
    studio: "edit",
    popular: true,
    keywords: ["annotate", "text", "draw", "highlight", "shapes", "write"],
    outputs: ["Edited PDF"],
  }),
  tool({
    id: "sign",
    name: "Sign PDF",
    short: "Sign",
    group: "edit",
    icon: "sign",
    tagline: "A signature where it belongs.",
    description:
      "Draw, type or upload a signature and place it on any page. Add an optional signature certificate page and a SHA-256 audit trail.",
    accept: PDF_ACCEPT,
    studio: "sign",
    popular: true,
    keywords: ["signature", "initial", "approve", "contract", "audit"],
    outputs: ["Signed PDF", "JSON signature audit"],
  }),
  tool({
    id: "metadata",
    name: "Edit metadata",
    short: "Metadata",
    group: "edit",
    icon: "metadata",
    tagline: "The details behind the document.",
    description:
      "Read and rewrite title, author, subject, creator and keywords. PaperLab shows you exactly what changed before you download.",
    accept: PDF_ACCEPT,
    special: "metadata",
    keywords: ["properties", "title", "author", "keywords", "info"],
    fields: [
      { key: "title", label: "Title", type: "text", placeholder: "Document title", width: "full" },
      { key: "author", label: "Author", type: "text", placeholder: "Person or team", width: "half" },
      { key: "subject", label: "Subject", type: "text", placeholder: "What is it about?", width: "half" },
      { key: "creator", label: "Creator", type: "text", placeholder: "Application or studio", width: "half" },
      { key: "keywords", label: "Keywords", type: "text", placeholder: "report, finance, 2026", help: "Comma-separated.", width: "half" },
      passwordField,
    ],
    outputs: ["PDF with updated metadata", "Before/after summary"],
  }),

  /* ------------------------------------------------------------------ */
  /* Security                                                            */
  /* ------------------------------------------------------------------ */
  tool({
    id: "protect",
    name: "Protect PDF",
    short: "Protect",
    group: "security",
    icon: "protect",
    tagline: "A password between your file and the world.",
    description:
      "Encrypt with AES-256 and choose exactly what readers may do: print, copy, edit, annotate or fill forms.",
    accept: PDF_ACCEPT,
    popular: true,
    keywords: ["password", "encrypt", "lock", "permissions", "secure"],
    fields: [
      {
        key: "userPassword",
        label: "Open password",
        type: "password",
        placeholder: "Required to open the PDF",
        required: true,
        width: "half",
        help: "Share this with the people who should read it.",
      },
      {
        key: "ownerPassword",
        label: "Owner password",
        type: "password",
        placeholder: "Optional",
        width: "half",
        help: "Leave empty to generate a strong owner password automatically.",
        advanced: true,
      },
      {
        key: "permissions",
        label: "Allow readers to",
        type: "checks",
        default: ["allowPrinting", "allowCopying", "allowAccessibility"],
        options: [
          { value: "allowPrinting", label: "Print" },
          { value: "allowCopying", label: "Copy text and images" },
          { value: "allowModifying", label: "Modify content" },
          { value: "allowAnnotating", label: "Annotate" },
          { value: "allowForms", label: "Fill forms" },
          { value: "allowAssembling", label: "Assemble pages" },
          { value: "allowAccessibility", label: "Screen readers" },
        ],
      },
    ],
    outputs: ["Encrypted PDF"],
  }),
  tool({
    id: "unlock",
    name: "Unlock PDF",
    short: "Unlock",
    group: "security",
    icon: "unlock",
    tagline: "Remove encryption from a file you own.",
    description:
      "Decrypt a password-protected PDF when you know the password. PaperLab never stores or transmits the password anywhere else.",
    accept: PDF_ACCEPT,
    keywords: ["decrypt", "password", "remove protection", "open"],
    fields: [
      {
        key: "password",
        label: "Current password",
        type: "password",
        placeholder: "Password used to open the file",
        required: true,
      },
    ],
    outputs: ["Unlocked PDF"],
  }),
  tool({
    id: "redact",
    name: "Redact PDF",
    short: "Redact",
    group: "security",
    icon: "redact",
    tagline: "Remove the words, not just cover them.",
    description:
      "Search for terms or draw boxes, then rasterise the affected pages so the hidden text is truly gone. A JSON report records what was removed.",
    accept: PDF_ACCEPT,
    visual: "redact",
    popular: true,
    keywords: ["black out", "censor", "hide", "sensitive", "gdpr"],
    fields: [
      {
        key: "terms",
        label: "Words to find and redact",
        type: "textarea",
        placeholder: "One term per line\nAccount number\nJane Doe",
        help: "Each matching word or phrase is located on every page. Case-insensitive.",
        width: "full",
      },
      passwordField,
    ],
    outputs: ["Redacted PDF", "Redaction report (JSON)"],
    notes: "Redaction is permanent. Work on a copy and check the result before sharing.",
  }),
  tool({
    id: "compare",
    name: "Compare PDF",
    short: "Compare",
    group: "security",
    icon: "compare",
    tagline: "See exactly what changed.",
    description:
      "Place two versions side by side. PaperLab renders every page, highlights changed pixels and reports text differences with page numbers.",
    accept: PDF_ACCEPT,
    multiple: true,
    minFiles: 2,
    maxFiles: 2,
    keywords: ["diff", "changes", "versions", "revision", "side by side"],
    fields: [
      {
        key: "dpi",
        label: "Comparison quality",
        type: "select",
        default: 110,
        options: [
          { value: 90, label: "Fast · 90 dpi" },
          { value: 110, label: "Balanced · 110 dpi" },
          { value: 150, label: "Detailed · 150 dpi" },
        ],
      },
      passwordField,
    ],
    outputs: ["Side-by-side comparison images", "Change report"],
    tips: ["Upload the older version first, then the newer one."],
  }),

  /* ------------------------------------------------------------------ */
  /* Forms                                                               */
  /* ------------------------------------------------------------------ */
  tool({
    id: "fill-form",
    name: "Fill PDF form",
    short: "Fill form",
    group: "forms",
    icon: "form",
    tagline: "Fill AcroForms without a printer.",
    description:
      "PaperLab reads the form fields and builds a proper input for each one: text, dates, checkboxes, radio groups and lists. Values stay in the document.",
    accept: PDF_ACCEPT,
    special: "fill-form",
    keywords: ["acroform", "fields", "checkbox", "application", "input"],
    fields: [passwordField],
    outputs: ["Filled PDF"],
  }),
  tool({
    id: "export-form",
    name: "Export form data",
    short: "Export form",
    group: "forms",
    icon: "export",
    tagline: "Form values as structured JSON.",
    description:
      "Download every field name, type, page and current value as JSON. Useful for archiving submissions or moving data into another system.",
    accept: PDF_ACCEPT,
    keywords: ["json", "fields", "data", "extract", "archive"],
    fields: [passwordField],
    outputs: ["JSON file"],
  }),

  /* ------------------------------------------------------------------ */
  /* AI / reading                                                        */
  /* ------------------------------------------------------------------ */
  tool({
    id: "summarize",
    name: "AI Summarizer",
    short: "Summarize",
    group: "ai",
    icon: "summarize",
    tagline: "The gist, with the detail left in.",
    description:
      "Produce a short, medium or long summary in paragraphs or bullets. Connect an AI provider for fluent synthesis; otherwise PaperLab uses local extractive ranking.",
    accept: PDF_ACCEPT,
    ai: true,
    popular: true,
    keywords: ["summary", "tldr", "key points", "abstract", "notes"],
    fields: [
      {
        key: "length",
        label: "Length",
        type: "segment",
        default: "medium",
        options: [
          { value: "short", label: "Short" },
          { value: "medium", label: "Medium" },
          { value: "long", label: "Long" },
        ],
      },
      {
        key: "style",
        label: "Style",
        type: "segment",
        default: "paragraphs",
        options: [
          { value: "paragraphs", label: "Paragraphs" },
          { value: "bullets", label: "Bullets" },
        ],
      },
      {
        key: "language",
        label: "Summary language",
        type: "select",
        default: "auto",
        options: LANGUAGES,
        width: "half",
      },
      pagesField("Summarise only part of the document, if you like."),
      passwordField,
    ],
    outputs: ["Summary PDF", "Plain-text summary"],
  }),
  tool({
    id: "translate",
    name: "Translate PDF",
    short: "Translate",
    group: "ai",
    icon: "translate",
    tagline: "A readable translation, not a screenshot.",
    description:
      "Translate the document text and rebuild it as a clean, selectable PDF plus a text file. Requires an AI provider or LibreTranslate on the server.",
    accept: PDF_ACCEPT,
    ai: true,
    keywords: ["language", "spanish", "french", "hindi", "localize"],
    fields: [
      {
        key: "target",
        label: "Translate into",
        type: "select",
        default: "es",
        options: TARGET_LANGUAGES,
        width: "half",
        required: true,
      },
      {
        key: "source",
        label: "Source language",
        type: "select",
        default: "auto",
        options: LANGUAGES,
        width: "half",
      },
      passwordField,
    ],
    outputs: ["Translated PDF", "Translated TXT"],
  }),
  tool({
    id: "ask-pdf",
    name: "Chat with PDF",
    short: "Ask PDF",
    group: "ai",
    icon: "chat",
    tagline: "Ask the document a direct question.",
    description:
      "Get an answer grounded in the document, with page citations. The interactive chat keeps context across follow-up questions.",
    accept: PDF_ACCEPT,
    ai: true,
    popular: true,
    keywords: ["question", "answer", "chat", "rag", "search"],
    fields: [
      {
        key: "question",
        label: "Your question",
        type: "textarea",
        placeholder: "What are the main findings, and which pages support them?",
        required: true,
        width: "full",
      },
      passwordField,
    ],
    outputs: ["Answer JSON", "Answer TXT"],
    chat: true,
  }),
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export const POPULAR_TOOLS = TOOLS.filter((t) => t.popular);

export function toolsByGroup(group) {
  return TOOLS.filter((t) => t.group === group);
}

export function toolsForExtension(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "pdf") {
    return TOOLS.filter((t) => t.group !== "convert" || t.accept.includes(".pdf")).filter(
      (t) => !["jpg-to-pdf", "scan-to-pdf", "word-to-pdf", "powerpoint-to-pdf", "excel-to-pdf", "html-to-pdf"].includes(t.id)
    );
  }
  if (["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "bmp"].includes(e)) {
    return TOOLS.filter((t) => ["jpg-to-pdf", "scan-to-pdf"].includes(t.id));
  }
  if (["docx", "doc", "rtf", "odt"].includes(e)) {
    return TOOLS.filter((t) => t.id === "word-to-pdf");
  }
  if (["pptx", "ppt", "odp"].includes(e)) {
    return TOOLS.filter((t) => t.id === "powerpoint-to-pdf");
  }
  if (["xlsx", "xls", "csv", "ods"].includes(e)) {
    return TOOLS.filter((t) => t.id === "excel-to-pdf");
  }
  if (["html", "htm"].includes(e)) {
    return TOOLS.filter((t) => t.id === "html-to-pdf");
  }
  return [];
}

export function searchTools(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return TOOLS;
  const terms = q.split(/\s+/).filter(Boolean);
  return TOOLS.map((t) => {
    const haystack = [t.id, t.name, t.short, t.tagline, t.description, ...(t.keywords || [])]
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!haystack.includes(term)) return null;
      if (t.name.toLowerCase().startsWith(term)) score += 5;
      else if (t.name.toLowerCase().includes(term)) score += 3;
      else if ((t.keywords || []).some((k) => k.includes(term))) score += 2;
      else score += 1;
    }
    return { tool: t, score };
  })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .map((r) => r.tool);
}

export function toolHref(id, extra = {}) {
  const params = new URLSearchParams({ tool: id, ...extra });
  return `tool.html?${params}`;
}
