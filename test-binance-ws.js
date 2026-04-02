/* 
   Test script to verify Binance free WebSocket is working
*/

const WebSocket = require('ws');

console.log('🔍 Testing Binance Free WebSocket Connection...\n');

// Test 1: Simple Binance WebSocket connectivity
function testBinanceWebSocket() {
    return new Promise((resolve, reject) => {
        const wsUrl = 'wss://stream.binance.com:9443/ws/btcusdt@kline_1m';
        const ws = new WebSocket(wsUrl);
        let dataReceived = false;
        let error = null;

        const timeout = setTimeout(() => {
            ws.close();
            if (!dataReceived && !error) {
                error = 'Timeout: No data received within 10 seconds';
            }
            if (error) {
                reject(error);
            } else {
                resolve({ success: true, messages: 'Connection established and data received' });
            }
        }, 10000);

        ws.on('open', () => {
            console.log('✅ WebSocket connection opened');
        });

        ws.on('message', (data) => {
            if (!dataReceived) {
                dataReceived = true;
                try {
                    const parsed = JSON.parse(data);
                    console.log('✅ Data received successfully');
                    console.log(`   - Event type: ${parsed.e}`);
                    console.log(`   - Symbol: ${parsed.s}`);
                    console.log(`   - Price: ${parsed.k.c}`);
                    console.log(`   - Volume: ${parsed.k.v}`);
                    clearTimeout(timeout);
                    ws.close();
                    resolve({ success: true, message: 'Connection successful and data flowing' });
                } catch (e) {
                    console.error('❌ Failed to parse message:', e.message);
                    error = e;
                }
            }
        });

        ws.on('error', (err) => {
            console.error('❌ WebSocket error:', err.message);
            error = err;
            clearTimeout(timeout);
            reject(err);
        });

        ws.on('close', () => {
            if (!dataReceived && !error) {
                console.log('⚠️  Connection closed before receiving data');
            }
        });
    });
}

// Test 2: Test REST API (alternative method)
function testBinanceRestAPI() {
    return new Promise((resolve, reject) => {
        console.log('\n🔍 Testing Binance REST API (alternative)...');
        
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
            .then(res => res.json())
            .then(data => {
                if (data.price) {
                    console.log('✅ Binance REST API is working');
                    console.log(`   - BTC/USDT: $${data.price}`);
                    resolve({ success: true, message: 'REST API working' });
                } else {
                    reject('No price data received');
                }
            })
            .catch(err => {
                console.error('❌ Binance REST API error:', err.message);
                reject(err);
            });
    });
}

// Run all tests
async function runTests() {
    console.log('Test 1: Binance WebSocket (streaming data)\n');
    try {
        const wsResult = await testBinanceWebSocket();
        console.log('\n✅ WebSocket Test PASSED\n');
    } catch (err) {
        console.log(`\n❌ WebSocket Test FAILED: ${err.message}\n`);
    }

    try {
        const restResult = await testBinanceRestAPI();
        console.log('\n✅ REST API Test PASSED\n');
    } catch (err) {
        console.log(`\n❌ REST API Test FAILED: ${err.message}\n`);
    }

    console.log('═'.repeat(50));
    console.log('Test completed. Check results above.');
    console.log('═'.repeat(50));
    process.exit(0);
}

runTests();
