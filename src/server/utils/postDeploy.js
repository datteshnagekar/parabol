import getRethink from 'server/database/rethinkDriver'

const flushSocketConnections = async () => {
  const r = getRethink()
  return r.table('User').update({
    connectedSockets: []
  })
}

const storePersistedQueries = async () => {
  const queryMap = require('../graphql/queryMap.json')
  const hashes = Object.keys(queryMap)
  const records = hashes.map((hash) => ({
    id: hash,
    query: queryMap[hash]
  }))

  const r = getRethink()
  const res = await r.table('QueryMap').insert(records)
  console.log(`Added ${res.inserted} records to the queryMap`)
}

const postDeploy = async () => {
  const r = getRethink()
  await flushSocketConnections()
  await storePersistedQueries()
  await r.getPoolMaster().drain()
  process.exit()
}

export default postDeploy
