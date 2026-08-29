const http = require('http');
const https = require('https');
const axios = require('axios');

// Create a local test HTTP server that serves 100KB dummy image buffer
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(Buffer.alloc(100 * 1024, 0xab));
});

const httpAgentKeepAlive = new http.Agent({ keepAlive: true, maxSockets: 50 });
const axiosKeepAlive = axios.create({ httpAgent: httpAgentKeepAlive });

async function runBenchmark() {
    await new Promise(resolve => server.listen(9876, resolve));
    const testUrl = 'http://127.0.0.1:9876/image.jpg';

    console.log("=========================================");
    console.log("  Image Download Client Benchmark (Local Server)");
    console.log("=========================================\n");

    const ITERATIONS = 20;

    // 1. Axios Default (New Connection each time)
    let totalAxiosDefault = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        const start = process.hrtime.bigint();
        const res = await axios.get(testUrl, { responseType: 'arraybuffer' });
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        totalAxiosDefault += ms;
    }
    const avgAxiosDefault = totalAxiosDefault / ITERATIONS;
    console.log(`1. Current Axios (No Keep-Alive): ${avgAxiosDefault.toFixed(2)} ms/req`);

    // 2. Axios with Keep-Alive Agent
    let totalAxiosKeepAlive = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        const start = process.hrtime.bigint();
        const res = await axiosKeepAlive.get(testUrl, { responseType: 'arraybuffer' });
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        totalAxiosKeepAlive += ms;
    }
    const avgAxiosKeepAlive = totalAxiosKeepAlive / ITERATIONS;
    console.log(`2. Axios with Keep-Alive Agent:   ${avgAxiosKeepAlive.toFixed(2)} ms/req`);

    // 3. Native Node.js fetch (Undici Engine with built-in connection pool)
    let totalNativeFetch = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        const start = process.hrtime.bigint();
        const res = await fetch(testUrl);
        const arrayBuf = await res.arrayBuffer();
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        totalNativeFetch += ms;
    }
    const avgNativeFetch = totalNativeFetch / ITERATIONS;
    console.log(`3. Native Node.js fetch (Undici): ${avgNativeFetch.toFixed(2)} ms/req`);

    console.log("\n=========================================");
    console.log("  Summary:");
    console.log(`  - Keep-Alive Axios is ${(avgAxiosDefault / avgAxiosKeepAlive).toFixed(1)}x faster`);
    console.log(`  - Native fetch is     ${(avgAxiosDefault / avgNativeFetch).toFixed(1)}x faster`);
    console.log("=========================================");

    server.close();
}

runBenchmark().catch(err => {
    console.error(err);
    server.close();
});
