// A minimal fake of the parts of the VS Code API the extension uses, aliased in for 'vscode'.
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;
export const ViewColumn = { Beside: -2 } as const;

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}
export class Range {
  start: Position;
  end: Position;
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}
export class Diagnostic {
  source?: string;
  code?: string;
  constructor(
    public range: Range,
    public message: string,
    public severity: number,
  ) {}
}
export class MarkdownString {
  constructor(public value = '') {}
}
export class Hover {
  constructor(public contents: MarkdownString) {}
}

type Listener<T> = (event: T) => void;
const disposable = { dispose() {} };

export interface FakeDocument {
  uri: { toString(): string; fsPath: string };
  languageId: string;
  version: number;
  getText(): string;
}

export function fakeDocument(
  name: string,
  languageId: string,
  text: string,
  version = 1,
): FakeDocument {
  return {
    uri: { toString: () => `file:///${name}`, fsPath: `/${name}` },
    languageId,
    version,
    getText: () => text,
  };
}

export const state = {
  collections: new Map<string, Map<string, Diagnostic[]>>(),
  hoverProviders: [] as {
    provideHover(doc: FakeDocument, position: Position): Hover | undefined;
  }[],
  commands: new Map<string, () => unknown>(),
  open: [] as Listener<FakeDocument>[],
  change: [] as Listener<{ document: FakeDocument }>[],
  close: [] as Listener<FakeDocument>[],
  config: [] as Listener<{ affectsConfiguration(section: string): boolean }>[],
  settings: {} as Record<string, unknown>,
  textDocuments: [] as FakeDocument[],
  activeDocument: undefined as FakeDocument | undefined,
  warnings: [] as string[],
  infos: [] as string[],
  openedDocuments: [] as { language: string; content: string }[],
};

export function reset(): void {
  state.collections.clear();
  state.hoverProviders.length = 0;
  state.commands.clear();
  for (const k of ['open', 'change', 'close', 'config'] as const) state[k].length = 0;
  state.settings = {};
  state.textDocuments = [];
  state.activeDocument = undefined;
  state.warnings = [];
  state.infos = [];
  state.openedDocuments = [];
}

export const languages = {
  createDiagnosticCollection(name: string) {
    const store = new Map<string, Diagnostic[]>();
    state.collections.set(name, store);
    return {
      set: (uri: FakeDocument['uri'], list: Diagnostic[]) => store.set(uri.toString(), list),
      delete: (uri: FakeDocument['uri']) => store.delete(uri.toString()),
      dispose() {},
    };
  },
  registerHoverProvider(_selector: string, provider: (typeof state.hoverProviders)[number]) {
    state.hoverProviders.push(provider);
    return disposable;
  },
};

export const workspace = {
  get textDocuments() {
    return state.textDocuments;
  },
  workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
  getConfiguration: () => ({
    get: <T>(key: string, fallback: T): T =>
      key in state.settings ? (state.settings[key] as T) : fallback,
  }),
  onDidOpenTextDocument(l: Listener<FakeDocument>) {
    state.open.push(l);
    return disposable;
  },
  onDidChangeTextDocument(l: Listener<{ document: FakeDocument }>) {
    state.change.push(l);
    return disposable;
  },
  onDidCloseTextDocument(l: Listener<FakeDocument>) {
    state.close.push(l);
    return disposable;
  },
  onDidChangeConfiguration(l: Listener<{ affectsConfiguration(section: string): boolean }>) {
    state.config.push(l);
    return disposable;
  },
  async openTextDocument(options: { language: string; content: string }) {
    state.openedDocuments.push(options);
    return fakeDocument('untitled.md', options.language, options.content);
  },
};

export const window = {
  get activeTextEditor() {
    return state.activeDocument ? { document: state.activeDocument } : undefined;
  },
  showWarningMessage: async (message: string) => void state.warnings.push(message),
  showInformationMessage: async (message: string) => void state.infos.push(message),
  showTextDocument: async () => undefined,
};

export const commands = {
  registerCommand(id: string, fn: () => unknown) {
    state.commands.set(id, fn);
    return disposable;
  },
};
