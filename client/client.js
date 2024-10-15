// client.js
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Konfigurasi
const TCP_PORT = 5000;
const UDP_PORT = 5001;
const SERVER_HOST = 'SERVER_IP_ADDRESS'; // Ganti dengan alamat IP server

// Daftar file yang akan diunduh
const filesToDownload = [
    '10KB.txt',
    '100KB.txt',
    '1MB.txt',
    '5MB.txt'
];

// Fungsi untuk membaca input dari user
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => rl.question(query, (ans) => {
        rl.close();
        resolve(ans);
    }));
}

// Fungsi untuk mengukur waktu dengan process.hrtime
function getDurationInMilliseconds(start) {
    const diff = process.hrtime(start);
    return (diff[0] * 1e3) + (diff[1] / 1e6); // Konversi ke milidetik
}

// Fungsi untuk Mengirim Permintaan dan Menerima File melalui TCP
function requestFileTCP(requestedPath, savePath) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        const startTime = process.hrtime();
        let fileBuffer = Buffer.alloc(0);  // Buffer untuk menyimpan data yang diterima

        client.connect(TCP_PORT, SERVER_HOST, () => {
            console.log(`TCP: Mengirim permintaan untuk file: ${requestedPath}`);
            client.write(requestedPath + '\n');
        });

        client.on('data', (data) => {
            if (data.toString().startsWith('ERROR')) {
                console.error(`TCP: ${data.toString().trim()}`);
                client.destroy();
                fs.unlink(savePath, () => {}); // Menghapus file yang mungkin telah dibuat
                reject(new Error(data.toString()));
                return;
            }
            fileBuffer = Buffer.concat([fileBuffer, data]);  // Tambah data ke buffer
        });

        client.on('end', () => {
            const duration = getDurationInMilliseconds(startTime);
            fs.writeFile(savePath, fileBuffer, (err) => {  // Simpan data ke file setelah transfer selesai
                if (err) {
                    console.error(`TCP: Gagal menyimpan file: ${err.message}`);
                    reject(err);
                    return;
                }
                console.log(`TCP: File diterima dan disimpan sebagai ${savePath} dalam ${duration.toFixed(2)} ms`);
                resolve();
            });
        });

        client.on('error', (err) => {
            console.error(`TCP Client Error: ${err.message}`);
            fs.unlink(savePath, () => {}); // Menghapus file yang mungkin telah dibuat
            reject(err);
        });
    });
}

// Fungsi untuk Mengirim Permintaan dan Menerima File melalui UDP
function requestFileUDP(requestedPath, savePath) {
    return new Promise((resolve, reject) => {
        const client = dgram.createSocket('udp4');
        const startTime = process.hrtime();
        let fileData = Buffer.alloc(0);
        let timeoutHandle;

        // Mengirim permintaan file
        client.send(requestedPath, 0, requestedPath.length, UDP_PORT, SERVER_HOST, (err) => {
            if (err) {
                console.error(`UDP: Gagal mengirim permintaan: ${err.message}`);
                client.close();
                return reject(err);
            }
            console.log(`UDP: Mengirim permintaan untuk file: ${requestedPath}`);
        });

        client.on('message', (msg, rinfo) => {
            if (msg.toString().startsWith('ERROR')) {
                console.error(`UDP: ${msg.toString().trim()}`);
                clearTimeout(timeoutHandle);
                client.close();
                reject(new Error(msg.toString()));
                return;
            }
            fileData = Buffer.concat([fileData, msg]);

            // Reset timeout setiap kali menerima pesan
            clearTimeout(timeoutHandle);
            timeoutHandle = setTimeout(() => {
                // Asumsi pengiriman selesai jika tidak ada data dalam jangka waktu tertentu
                fs.writeFile(savePath, fileData, (err) => {
                    if (err) {
                        console.error(`UDP: Gagal menyimpan file: ${err.message}`);
                        return reject(err);
                    }
                    const duration = getDurationInMilliseconds(startTime);
                    console.log(`UDP: File diterima dan disimpan sebagai ${savePath} dalam ${duration.toFixed(2)} ms`);
                    client.close();
                    resolve();
                });
            }, 1000); // 1 detik timeout
        });

        // Timeout keseluruhan
        timeoutHandle = setTimeout(() => {
            client.close();
            fs.writeFile(savePath, fileData, (err) => {
                if (err) {
                    console.error(`UDP: Gagal menyimpan file: ${err.message}`);
                    return reject(err);
                }
                const duration = getDurationInMilliseconds(startTime);
                console.log(`UDP: File diterima dan disimpan sebagai ${savePath} dalam ${duration.toFixed(2)} ms`);
                resolve();
            });
        }, 5000); // 5 detik timeout

        client.on('error', (err) => {
            console.error(`UDP Client Error: ${err.message}`);
            clearTimeout(timeoutHandle);
            client.close();
            reject(err);
        });

        client.on('close', () => {
            clearTimeout(timeoutHandle);
        });
    });
}

// Fungsi Utama
async function main() {
    const protocol = await askQuestion('Pilih protokol (TCP/UDP): ');

    const saveDirectory = path.join(__dirname, 'downloads');
    if (!fs.existsSync(saveDirectory)) {
        fs.mkdirSync(saveDirectory, { recursive: true });
    }

    for (const fileName of filesToDownload) {
        const savePath = path.join(saveDirectory, fileName);
        try {
            if (protocol.toUpperCase() === 'TCP') {
                await requestFileTCP(fileName, savePath);
            } else if (protocol.toUpperCase() === 'UDP') {
                await requestFileUDP(fileName, savePath);
            } else {
                console.error('Protokol tidak dikenal. Pilih "TCP" atau "UDP".');
                break;
            }
        } catch (err) {
            console.error(`Gagal mengunduh file ${fileName}: ${err.message}`);
        }
    }

    console.log('\nSemua data telah dikirim.');
    process.exit();
}

main();