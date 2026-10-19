// English messages (A11Y-23). Importing questions from a file (docs/testids/phase-6.md, "Upload dialog").
export const imports = {
  'imports.fromFile': 'Import from file',
  'imports.title': 'Import questions from a file',
  'imports.formats':
    'JSON, PDF, XLSX, CSV, TXT or MD, up to 25 MB. PDFs can have up to 100 pages and sheets up to 5,000 rows.',
  'imports.file': 'File',
  'imports.submit': 'Start import',
  'imports.noFile': 'Choose a file to import.',
  'imports.unsupported': "This file type can't be imported. Use JSON, PDF, XLSX, CSV, TXT or MD.",
  'imports.tooLarge': 'This file is larger than 25 MB. Split it into smaller files.',
  'imports.mismatch': "This file isn't a real {format} file. Check the file and try again.",
  'imports.limitReached':
    "This month's AI import limit ({n}) is used up. JSON files and template sheets can still be imported.",
  'imports.aiOff': "PDF, TXT and MD imports use AI, which is not included in your organization's plan.",
  'imports.uploadFailed': "Couldn't upload the file. Check your connection, then try again.",
  'imports.failed': "Couldn't start the import. {reason}",
} as const;
