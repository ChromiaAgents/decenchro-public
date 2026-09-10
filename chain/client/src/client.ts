import { createClient, encryption, IClient } from "postchain-client";
import {
  createConnection,
  createSession,
  createAuthDataService,
  Connection,
  Session,
} from "@chromia/ft4";
import {
  createInMemoryFtKeyStore,
  createAuthenticator,
  getKeyHandlersForKeyStores,
  registrationStrategy,
  registerAccount,
  createSingleSigAuthDescriptorRegistration,
} from "@chromia/ft4";
import { CHROMIA_NODE_URL, CHROMIA_BRID, ADMIN_PRIVKEY, requireEnv } from "./config.js";

let clientInstance: IClient | null = null;
let connectionInstance: Connection | null = null;
let sessionInstance: Session | null = null;

function getKeyPair() {
  const privKey = requireEnv("ADMIN_PRIVKEY", ADMIN_PRIVKEY);
  return encryption.makeKeyPair(Buffer.from(privKey, "hex"));
}

export async function getClient(): Promise<IClient> {
  if (clientInstance) return clientInstance;
  const brid = requireEnv("CHROMIA_BRID", CHROMIA_BRID);
  clientInstance = await createClient({
    nodeUrlPool: CHROMIA_NODE_URL,
    blockchainRid: brid,
  });
  return clientInstance;
}

export async function getConnection(): Promise<Connection> {
  if (connectionInstance) return connectionInstance;
  const client = await getClient();
  connectionInstance = createConnection(client);
  return connectionInstance;
}

export async function ensureAccount(): Promise<Session> {
  if (sessionInstance) return sessionInstance;

  const connection = await getConnection();
  const keyPair = getKeyPair();
  const keyStore = createInMemoryFtKeyStore(keyPair);

  // Check if account already exists
  const accounts = await connection.getAccountsFiltered({ signers: [keyPair.pubKey] }, 1);

  if (accounts.data.length > 0) {
    const account = accounts.data[0];
    const authDataService = createAuthDataService(connection);
    const keyHandlers = await getKeyHandlersForKeyStores(connection, account.id, [keyStore]);
    const authenticator = createAuthenticator(account.id, keyHandlers, authDataService);
    sessionInstance = createSession(connection, authenticator);
    return sessionInstance;
  }

  // Register new account with open strategy
  const authDescriptor = createSingleSigAuthDescriptorRegistration(
    ["A", "T"],
    keyPair.pubKey
  );
  const strategy = registrationStrategy.open(authDescriptor);
  const { session } = await registerAccount(
    await getClient(),
    keyStore,
    strategy
  );
  sessionInstance = session;
  return sessionInstance;
}

export function getPubKey(): Buffer {
  return getKeyPair().pubKey;
}
