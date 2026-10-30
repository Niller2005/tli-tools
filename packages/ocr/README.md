# @tli/ocr

The `tesseract` program, run over a PNG. It is the part of the reading both
readers share: the program is run, the arguments and the environment are the
same, and the TSV it writes is read back into lines with their boxes.

What a reader does with the text is its own business (Warden stretches the
contrast and reads regions; Vorax's helper reads the cards' names).

## What it gives

- `tesseractFound()` — whether the program runs.
- `runTesseract(png, args?)` — runs `tesseract stdin stdout` over the PNG and
  gives back what it wrote (`out`) and whether it succeeded (`ok`). The
  default arguments are `--psm 6 -l eng`; the run is given one thread
  (`OMP_THREAD_LIMIT=1`), as the regions are small and several are read at
  once.
- `parseTsv(tsv)` — the lines of tesseract's TSV: its words grouped by block,
  paragraph and line, each with its box in the image's pixels.
- `TESSERACT_ARGS`, `TextLine`, `TesseractResult`.
