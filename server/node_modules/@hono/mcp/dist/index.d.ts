import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransportOptions } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { Context } from 'hono';

/**
 * @module
 * MCP HTTP Streaming Helper for Hono.
 */

declare class StreamableHTTPTransport implements Transport {
    #private;
    sessionId?: string | undefined;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage, extra?: {
        authInfo?: AuthInfo;
    }) => void;
    constructor(options?: StreamableHTTPServerTransportOptions);
    /**
     * Starts the transport. This is required by the Transport interface but is a no-op
     * for the Streamable HTTP transport as connections are managed per-request.
     */
    start(): Promise<void>;
    /**
     * Handles an incoming HTTP request, whether GET or POST
     */
    handleRequest(ctx: Context, parsedBody?: unknown): Promise<Response | undefined>;
    /**
     * Handles GET requests for SSE stream
     */
    private handleGetRequest;
    /**
     * Handles POST requests containing JSON-RPC messages
     */
    private handlePostRequest;
    /**
     * Handles DELETE requests to terminate sessions
     */
    private handleDeleteRequest;
    /**
     * Handles unsupported requests (PUT, PATCH, etc.)
     */
    private handleUnsupportedRequest;
    /**
     * Validates session ID for non-initialization requests
     * Returns true if the session is valid, false otherwise
     */
    private validateSession;
    close(): Promise<void>;
    send(message: JSONRPCMessage, options?: {
        relatedRequestId?: RequestId;
    }): Promise<void>;
}

export { StreamableHTTPTransport };
