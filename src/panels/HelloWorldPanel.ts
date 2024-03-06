import { EnhancedStore } from "@reduxjs/toolkit/dist/configureStore";
import {
	Disposable,
	ExtensionContext,
	Uri,
	ViewColumn,
	Webview,
	WebviewPanel,
	window,
} from "vscode";
import { userActions, workspaceActions } from "../todo/store";
import { TodoScope, TodoSlice } from "../todo/todoTypes";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { Message, MessageActionsFromWebview, messagesToWebview } from "./message";
/**
 * This class manages the state and behavior of HelloWorld webview panels.
 *
 * It contains all the data and methods for:
 *
 * - Creating and rendering HelloWorld webview panels
 * - Properly cleaning up and disposing of webview resources when the panel is closed
 * - Setting the HTML (and by proxy CSS/JavaScript) content of the webview panel
 * - Setting message listeners so data can be passed between the webview and extension
 */
export class HelloWorldPanel {
	public static currentPanel: HelloWorldPanel | undefined;
	private readonly _panel: WebviewPanel;
	private _disposables: Disposable[] = [];
	private _store: EnhancedStore;

	/**
	 * The HelloWorldPanel class private constructor (called only from the render method).
	 *
	 * @param panel A reference to the webview panel
	 * @param context The ExtensionContext
	 */
	private constructor(panel: WebviewPanel, context: ExtensionContext, store: EnhancedStore) {
		this._panel = panel;
		this._store = store;
		const extensionUri = context.extensionUri;

		// Set an event listener to listen for when the panel is disposed (i.e. when the user closes
		// the panel or when the panel is closed programmatically)
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Set the HTML content for the webview panel
		this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

		// Set an event listener to listen for messages passed from the webview context
		this._setWebviewMessageListener(this._panel.webview);

		this.reloadWebview();
	}

	/**
	 * Renders the current webview panel if it exists otherwise a new webview panel
	 * will be created and displayed.
	 *
	 * @param extensionUri The URI of the directory containing the extension.
	 */
	public static render(context: ExtensionContext, store: EnhancedStore) {
		const extensionUri = context.extensionUri;
		if (HelloWorldPanel.currentPanel) {
			// If the webview panel already exists and in focus, dispose it
			if (HelloWorldPanel.currentPanel._panel?.active) {
				HelloWorldPanel.currentPanel._panel.dispose();
			}
			// If the webview panel already exists but not in focus, reveal it
			else {
				HelloWorldPanel.currentPanel._panel.reveal(ViewColumn.Beside);
			}
		} else {
			// If a webview panel does not already exist create and show a new one
			const panel = window.createWebviewPanel(
				// Panel view type
				"showVscodeTodoWebview",
				// Panel title
				"Todo",
				// The editor column the panel should be displayed in
				ViewColumn.Beside,
				// Extra panel configurations
				{
					// Enable JavaScript in the webview
					enableScripts: true,
					// Restrict the webview to only load resources from the `out` and `webview-ui/build` directories
					localResourceRoots: [
						Uri.joinPath(extensionUri, "out"),
						Uri.joinPath(extensionUri, "webview-ui/build"),
					],
					retainContextWhenHidden: true,
					enableFindWidget: true,
				}
			);
			HelloWorldPanel.currentPanel = new HelloWorldPanel(panel, context, store);
		}
	}

	/**
	 * Sends the current state to the webview.
	 *
	 * @param {boolean} isReloadWebview - True to initialize the webview with initial data, false to sync state changes from the store.
	 */
	private reloadWebview() {
		const currentState = this._store.getState();
		this._panel.webview.postMessage(messagesToWebview.reloadWebview(currentState));
	}

	public updateWebview(newSliceState: TodoSlice) {
		this._panel.webview.postMessage(messagesToWebview.syncData(newSliceState));
	}

	/**
	 * Cleans up and disposes of webview resources when the webview panel is closed.
	 */
	public dispose() {
		HelloWorldPanel.currentPanel = undefined;

		// Dispose of the current webview panel
		this._panel.dispose();

		// Dispose of all disposables (i.e. commands) for the current webview panel
		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	/**
	 * Defines and returns the HTML that should be rendered within the webview panel.
	 *
	 * @remarks This is also the place where references to the Angular webview build files
	 * are created and inserted into the webview HTML.
	 *
	 * @param webview A reference to the extension webview
	 * @param extensionUri The URI of the directory containing the extension
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	private _getWebviewContent(webview: Webview, extensionUri: Uri) {
		// The CSS file from the Angular build output
		const stylesUri = getUri(webview, extensionUri, ["webview-ui", "build", "styles.css"]);
		// The JS files from the Angular build output
		const runtimeUri = getUri(webview, extensionUri, ["webview-ui", "build", "runtime.js"]);
		const polyfillsUri = getUri(webview, extensionUri, ["webview-ui", "build", "polyfills.js"]);
		const scriptUri = getUri(webview, extensionUri, ["webview-ui", "build", "main.js"]);

		const nonce = getNonce();

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
          <link rel="stylesheet" type="text/css" href="${stylesUri}">
          <title>Todo</title>
        </head>
        <body>
          <app-root></app-root>
          <script type="module" nonce="${nonce}" src="${runtimeUri}"></script>
          <script type="module" nonce="${nonce}" src="${polyfillsUri}"></script>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	private _setWebviewMessageListener(webview: Webview) {
		webview.onDidReceiveMessage(
			(message: Message<MessageActionsFromWebview, TodoScope>) => {
				let storeActions;
				if (message.scope === TodoScope.user) {
					storeActions = userActions;
				} else if (message.scope === TodoScope.workspace) {
					storeActions = workspaceActions;
				} else {
					console.error("Action scope not found");
					return;
				}
				switch (message.type) {
					case MessageActionsFromWebview.addTodo: {
						const { payload } = message as Message<MessageActionsFromWebview.addTodo, TodoScope>;
						this._store.dispatch(storeActions.addTodo(payload));
						break;
					}
					case MessageActionsFromWebview.deleteTodo: {
						const { payload } = message as Message<MessageActionsFromWebview.deleteTodo, TodoScope>;
						this._store.dispatch(storeActions.deleteTodo(payload));
						break;
					}
					case MessageActionsFromWebview.toggleTodo: {
						const { payload } = message as Message<MessageActionsFromWebview.toggleTodo, TodoScope>;
						this._store.dispatch(storeActions.toggleTodo(payload));
						break;
					}
					case MessageActionsFromWebview.editTodo: {
						const { payload } = message as Message<MessageActionsFromWebview.editTodo, TodoScope>;
						this._store.dispatch(storeActions.editTodo(payload));
						break;
					}
					case MessageActionsFromWebview.reorderTodo: {
						const { payload } = message as Message<MessageActionsFromWebview.reorderTodo, TodoScope>;
						this._store.dispatch(storeActions.reorderTodo(payload));
						break;
					}
					default:
						console.error("Action not found");
				}
			},
			undefined,
			this._disposables
		);
	}
}
