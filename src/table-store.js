import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { StoreConflict, StoreUnavailable } from './database.js';

export function openTableStore(endpoint, tableName, clientId) {
  const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new DefaultAzureCredential();
  const client = new TableClient(endpoint, tableName, credential, {
    retryOptions: { maxRetries: 3, retryDelayInMs: 500, maxRetryDelayInMs: 3000 },
  });
  return tableStore(client);
}

export function tableStore(client) {
  const decode = (row) => JSON.parse(row.document);
  async function read(namespace, id) {
    try { return await client.getEntity(namespace, id); }
    catch (error) { if (error.statusCode === 404) return null; throw error; }
  }
  const entity = (namespace, id, value) => ({ partitionKey: namespace, rowKey: id, document: JSON.stringify(value) });
  return {
    kind: 'azure-table',
    async get(namespace, id) { const row = await read(namespace, id); return row ? decode(row) : null; },
    async list(namespace) {
      const result = [];
      for await (const row of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${namespace.replaceAll("'", "''")}'` } })) result.push(decode(row));
      return result;
    },
    async create(namespace, id, value) {
      try { await client.createEntity(entity(namespace, id, value)); }
      catch (error) { if (error.statusCode === 409) throw new StoreConflict(); throw error; }
      return value;
    },
    async mutate(namespace, id, change) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await read(namespace, id);
        const value = change(current ? decode(current) : null);
        try {
          if (value === null) {
            if (current) await client.deleteEntity(namespace, id, { etag: current.etag });
          } else if (current) await client.updateEntity(entity(namespace, id, value), 'Replace', { etag: current.etag });
          else await client.createEntity(entity(namespace, id, value));
          return value;
        } catch (error) {
          if (![404, 409, 412].includes(error.statusCode)) throw error;
        }
      }
      throw new StoreUnavailable('Concurrent update retry limit reached');
    },
    async remove(namespace, id) {
      try { await client.deleteEntity(namespace, id); }
      catch (error) { if (error.statusCode !== 404) throw error; }
    },
    async check() {
      const iterator = client.listEntities({ queryOptions: { filter: "PartitionKey eq 'health'", top: 1 } });
      await iterator.next();
    },
    close() {},
  };
}
