/**
 * Structure-aware chunking — YOUR TASK (Bible chunking homework)
 *
 * Read docs/CHALLENGE-CHUNKING.md FIRST — the strategy is yours to choose
 * (by verse? chapter? packed passages? with overlap?) and defending that choice
 * is the assignment. The naive chunker (`npm run bible:fixed`) slices blindly by
 * character count and shreds verses mid-sentence; whatever you design should
 * beat it, and `npm run bible:audit` will measure both.
 *
 * You have: `loadVerses()` from ./parse returns [{ book, chapter, verse, text }].
 * You write: data/bible/chunks-smart.jsonl (one JSON chunk per line), each chunk
 * carrying metadata (at minimum a human-readable reference like "Genesis 1:1-5").
 */

import { loadVerses, Verse } from './parse';
import * as fs from 'fs';

type Chunk = {
  id: string;
  text: string;
  metadata: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    reference: string; // e.g. "Genesis 1:1-5"
  };
};

const MAX_CHARS = 1500;

/**
 * Project Gutenberg uses descriptive headings rather than canonical Bible book
 * names. Keep this conversion explicit: generic string cleanup would label its
 * first two "Books of the Kings" as Kings, even though they are 1/2 Samuel.
 *
 * These canonical names are used for readable references, filter metadata, and
 * deterministic ID slugs. The parser label remains the lookup key so a changed
 * source format fails visibly instead of creating misleading citations.
 */
const CANONICAL_BOOK_NAMES: Record<string, string> = {
  'The First Book of Moses: Called Genesis': 'Genesis',
  'The Second Book of Moses: Called Exodus': 'Exodus',
  'The Third Book of Moses: Called Leviticus': 'Leviticus',
  'The Fourth Book of Moses: Called Numbers': 'Numbers',
  'The Fifth Book of Moses: Called Deuteronomy': 'Deuteronomy',
  'The Book of Joshua': 'Joshua',
  'The Book of Judges': 'Judges',
  'The Book of Ruth': 'Ruth',
  'The First Book of the Kings': '1 Samuel',
  'The Second Book of the Kings': '2 Samuel',
  'The Third Book of the Kings': '1 Kings',
  'The Fourth Book of the Kings': '2 Kings',
  'The First Book of the Chronicles': '1 Chronicles',
  'The Second Book of the Chronicles': '2 Chronicles',
  Ezra: 'Ezra',
  'The Book of Nehemiah': 'Nehemiah',
  'The Book of Esther': 'Esther',
  'The Book of Job': 'Job',
  'The Book of Psalms': 'Psalms',
  'The Proverbs': 'Proverbs',
  'The Preacher': 'Ecclesiastes',
  'The Song of Solomon': 'Song of Solomon',
  'The Book of the Prophet Isaiah': 'Isaiah',
  'The Book of the Prophet Jeremiah': 'Jeremiah',
  'The Lamentations of Jeremiah': 'Lamentations',
  'The Book of the Prophet Ezekiel': 'Ezekiel',
  'The Book of Daniel': 'Daniel',
  Hosea: 'Hosea',
  Joel: 'Joel',
  Amos: 'Amos',
  Obadiah: 'Obadiah',
  Jonah: 'Jonah',
  Micah: 'Micah',
  Nahum: 'Nahum',
  Habakkuk: 'Habakkuk',
  Zephaniah: 'Zephaniah',
  Haggai: 'Haggai',
  Zechariah: 'Zechariah',
  Malachi: 'Malachi',
  'The Gospel According to Saint Matthew': 'Matthew',
  'The Gospel According to Saint Mark': 'Mark',
  'The Gospel According to Saint Luke': 'Luke',
  'The Gospel According to Saint John': 'John',
  'The Acts of the Apostles': 'Acts',
  'The Epistle of Paul the Apostle to the Romans': 'Romans',
  'The First Epistle of Paul the Apostle to the Corinthians': '1 Corinthians',
  'The Second Epistle of Paul the Apostle to the Corinthians': '2 Corinthians',
  'The Epistle of Paul the Apostle to the Galatians': 'Galatians',
  'The Epistle of Paul the Apostle to the Ephesians': 'Ephesians',
  'The Epistle of Paul the Apostle to the Philippians': 'Philippians',
  'The Epistle of Paul the Apostle to the Colossians': 'Colossians',
  'The First Epistle of Paul the Apostle to the Thessalonians': '1 Thessalonians',
  'The Second Epistle of Paul the Apostle to the Thessalonians': '2 Thessalonians',
  'The First Epistle of Paul the Apostle to Timothy': '1 Timothy',
  'The Second Epistle of Paul the Apostle to Timothy': '2 Timothy',
  'The Epistle of Paul the Apostle to Titus': 'Titus',
  'The Epistle of Paul the Apostle to Philemon': 'Philemon',
  'The Epistle of Paul the Apostle to the Hebrews': 'Hebrews',
  'The General Epistle of James': 'James',
  'The First Epistle General of Peter': '1 Peter',
  'The Second General Epistle of Peter': '2 Peter',
  'The First Epistle General of John': '1 John',
  'The Second Epistle General of John': '2 John',
  'The Third Epistle General of John': '3 John',
  'The General Epistle of Jude': 'Jude',
  'The Revelation of Saint John the Divine': 'Revelation',
};

/** Return a canonical name or stop before a source-label change can miscite data. */
function canonicalBookName(sourceBook: string): string {
  const canonicalName = CANONICAL_BOOK_NAMES[sourceBook];
  if (!canonicalName) {
    throw new Error(`No canonical name configured for parser book: ${sourceBook}`);
  }
  return canonicalName;
}

/**
 * Creates the human-readable citation stored in each chunk's metadata.
 * Uses a single verse number when the chunk contains one verse, otherwise
 * includes the inclusive first-to-last verse range.
 */
function formatReference(
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): string {
  const verseRange = verseStart === verseEnd ? `${verseStart}` : `${verseStart}-${verseEnd}`;
  return `${book} ${chapter}:${verseRange}`;
}

/** Converts a canonical book name into a stable, ID-safe component. */
function slugifyBook(book: string): string {
  return book
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Chunking flow, in plain English:
 *
 * 1. Load every parsed verse once. `verses` is the complete source corpus and
 *    is never changed.
 * 2. Start with an empty `currentVerses` buffer. It represents one passage
 *    currently being assembled from consecutive complete verses.
 * 3. Read verses in their original order. Before adding a verse, check whether
 *    it starts a different book/chapter or would make the buffered passage
 *    exceed MAX_CHARS. In either case, finish the existing passage first.
 * 4. Finishing (flushing) a passage preserves the verse text and numbers,
 *    creates its canonical reference and deterministic ID, pushes it into
 *    `chunks`, then resets the buffer for the next passage.
 * 5. A verse is never split. The size cap applies only when a passage already
 *    has a verse, so an unusually long individual verse remains intact.
 * 6. Flush once more after the loop because the final passage has no following
 *    verse to trigger its boundary.
 *
 * The next checkpoint writes the completed `chunks` array as JSONL, then audits
 * the generated file before any embedding or Pinecone work begins.
 */
function main() {
  const verses: Verse[] = loadVerses();
  const chunks: Chunk[] = [];
  let currentVerses: Verse[] = [];

  console.log(`Loaded ${verses.length} verses.`);

  function flushCurrentChunk(): void {
    if (currentVerses.length === 0) return;

    const firstVerse = currentVerses[0];
    const lastVerse = currentVerses[currentVerses.length - 1];

    const book = canonicalBookName(firstVerse.book);
    const chapter = firstVerse.chapter;
    const verseStart = firstVerse.verse;
    const verseEnd = lastVerse.verse;

    const text = currentVerses.map(verse => `${verse.verse} ${verse.text}`).join('\n');

    const reference = formatReference(book, chapter, verseStart, verseEnd);
    const id = [
      'kjv',
      slugifyBook(book),
      String(chapter).padStart(3, '0'),
      String(verseStart).padStart(3, '0'),
      String(verseEnd).padStart(3, '0'),
    ].join('-');

    const chunk: Chunk = {
      id,
      text,
      metadata: {
        book,
        chapter,
        verseStart,
        verseEnd,
        reference,
      },
    };

    chunks.push(chunk);
    currentVerses = [];
  }

  for (const verse of verses) {
    const firstBufferedVerse = currentVerses[0];

    const startsNewBookOrChapter =
      firstBufferedVerse !== undefined &&
      (verse.book !== firstBufferedVerse.book || verse.chapter !== firstBufferedVerse.chapter);

    const verseText = `${verse.verse} ${verse.text}`;
    const currentText = currentVerses
      .map(bufferedVerse => `${bufferedVerse.verse} ${bufferedVerse.text}`)
      .join('\n');

    const wouldExceedLimit =
      currentVerses.length > 0 && currentText.length + 1 + verseText.length > MAX_CHARS;

    if (startsNewBookOrChapter || wouldExceedLimit) {
      flushCurrentChunk();
    }
    currentVerses.push(verse);
  }
  flushCurrentChunk();

  // TODO — build structure-aware chunks:
  //  1. Walk verses in order, accumulating them into a buffer.
  //  2. Flush the buffer into a Chunk once it reaches the --target size...
  //  3. ...but NEVER split a verse, and NEVER let a chunk span two books.
  //  4. Optionally carry the last --overlap-verses verses into the next chunk.
  //  5. Tag each chunk with its book / chapter / verse-range `reference`.
  //  6. Write data/bible/chunks-smart.jsonl (JSON.stringify(chunk) per line).
  // Then: `npm run bible:audit -- data/bible/chunks-smart.jsonl` and compare it
  // to the fixed-size output. Why is the smart one better for retrieval?

  const outputPath = 'data/bible/chunks-smart.jsonl';

  fs.writeFileSync(outputPath, chunks.map(chunk => JSON.stringify(chunk)).join('\n'));

  console.log(`Loaded ${verses.length} verses.`);
  console.log(`Produced ${chunks.length} chunks.`);
  console.log(`Wrote ${outputPath}`);
}

main();
