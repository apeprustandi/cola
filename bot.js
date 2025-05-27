// bot.js
const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- KONFIGURASI AWAL ---
const PROXY_URL = "http://efaffdeeae06dce5e0d2__cr.id:64fbc900659e9587@gw.dataimpulse.com:823"; // Kosongkan jika tidak pakai proxy: const PROXY_URL = null;
const mainProxyAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined; // PROXY AGENT GLOBAL

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'; // Contoh User Agent, bisa disesuaikan
const DEFAULT_DOMAIN = 'ayo_coca_cola';
const FIREBASE_API_KEY = 'AIzaSyC2Jncgy1smi8CV91PG3sUZBDAo5raozYc'; // <--- GANTI INI DENGAN API KEY FIREBASE ANDA!
const GRIVY_CAMPAIGN_PUBLIC_CODE = 'tccc-coke-utc-2025-main';
const SUCCESSFUL_CLAIMS_JSON_FILE = 'hasil_klaim_voucher.json';
const DEFAULT_NUM_SPAM_ATTEMPTS = 100; // Default jika tidak diisi di CLI atau form
const REWARD_TO_SKIP_CLAIM = 'public-ayo-cola-utc-cinepolis-b1f1'; // Reward yang akan di-skip claimnya

const baseColors = {
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m', magenta: '\x1b[35m'
};
const noColors = {
    green: '', red: '', yellow: '', cyan: '', reset: '', magenta: ''
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function stripAnsi(str) {
    if (!str) return '';
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

async function saveSuccessfulClaimsToJson(successfulClaimsData, outputCollector, activeColors) {
    if (!successfulClaimsData || successfulClaimsData.length === 0) {
        return;
    }
    try {
        let allDataToSave = [];
        try {
            if (fs.existsSync(SUCCESSFUL_CLAIMS_JSON_FILE)) {
                const fileContent = fs.readFileSync(SUCCESSFUL_CLAIMS_JSON_FILE, 'utf8');
                if (fileContent) {
                    const parsedContent = JSON.parse(fileContent);
                    if (Array.isArray(parsedContent)) {
                        allDataToSave = parsedContent;
                    }
                }
            }
        } catch (readError) {
            outputCollector.push(`${activeColors.yellow}Peringatan saat membaca ${SUCCESSFUL_CLAIMS_JSON_FILE} yang ada: ${readError.message}${activeColors.reset}`);
        }

        const existingClaimKeys = new Set(allDataToSave.map(item => `${item.claimedVoucherCode}_${item.originalVoucherCode}_${item.linkUsed}_${item.redeemAttemptNo}`));
        let newClaimsAddedCount = 0;
        successfulClaimsData.forEach(claim => {
            const uniqueKey = `${claim.claimedVoucherCode}_${claim.originalVoucherCode}_${claim.linkUsed}_${claim.redeemAttemptNo}`;
            if (!existingClaimKeys.has(uniqueKey)) {
                allDataToSave.push(claim);
                existingClaimKeys.add(uniqueKey);
                newClaimsAddedCount++;
            }
        });

        if (newClaimsAddedCount > 0) {
            fs.writeFileSync(SUCCESSFUL_CLAIMS_JSON_FILE, JSON.stringify(allDataToSave, null, 2), 'utf8');
            // outputCollector.push(`${activeColors.green}${newClaimsAddedCount} data klaim sukses baru disimpan/diperbarui ke: ${SUCCESSFUL_CLAIMS_JSON_FILE}${activeColors.reset}`);
        } else {
            outputCollector.push(`${activeColors.yellow}Tidak ada data klaim sukses baru untuk disimpan (kemungkinan duplikat atau sudah ada).${activeColors.reset}`);
        }
    } catch (error) {
        outputCollector.push(`${activeColors.red}Error menyimpan data ke file JSON: ${error.message}${activeColors.reset}`);
    }
}

async function getFirebaseIdTokenFromLink(shortUrl) {
    console.log(`[Bot Detail] Memulai getFirebaseIdTokenFromLink untuk URL: ${shortUrl}`);
    if (!shortUrl || !shortUrl.includes('/')) {
        console.log('[Bot Detail] Format shortUrl tidak valid.');
        return null;
    }
    const extractedShortId = shortUrl.split('/').pop();
    if (!extractedShortId) {
        console.log('[Bot Detail] Tidak bisa mengekstrak shortId.');
        return null;
    }
    console.log(`[Bot Detail] shortId yang diekstrak: ${extractedShortId}`);
    
    const configForR1 = {
        headers: { 'accept-language': 'en-US,en;q=0.9', 'content-type': 'application/json', 'user-agent': USER_AGENT },
        timeout: 20000,
        httpsAgent: mainProxyAgent 
    };
    const configForR2AndR3 = {
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
        timeout: 20000,
        httpsAgent: mainProxyAgent
    };

    try {
        // console.log('[Bot Detail] Mencoba panggilan API /shortenerData...'); // User commented this out
        const r1 = await axios.post('https://us-central1-grivy-barcode.cloudfunctions.net/shortenerData',
            { data: { shortenerToken: extractedShortId, domain: DEFAULT_DOMAIN } },
            configForR1
        );
        // console.log('[Bot Detail] Status respons /shortenerData:', r1.status); // User commented this out

        const multiDomainToken = r1.data?.result?.data?.multi_domain_token;
        if (!multiDomainToken) {
            console.log('[Bot Detail] multi_domain_token tidak ditemukan dalam respons /shortenerData.');
            console.log('[Bot Detail] Respons penuh /shortenerData:', JSON.stringify(r1.data, null, 2));
            return null;
        }
        // console.log(`[Bot Detail] Mendapatkan multi_domain_token (awal): ${multiDomainToken.substring(0, 30)}...`); // User commented this out

        // console.log('[Bot Detail] Mencoba panggilan API /authenticateUser...'); // User commented this out
        const r2 = await axios.post('https://us-central1-grivy-barcode.cloudfunctions.net/authenticateUser',
            { data: { multiDomainToken, provider: 'whatsapp', domain: DEFAULT_DOMAIN } },
            configForR2AndR3
        );
        // console.log('[Bot Detail] Status respons /authenticateUser:', r2.status); // User commented this out

        const customAuthToken = r2.data?.data?.token;
        if (!customAuthToken) {
            console.log('[Bot Detail] customAuthToken (data.token) tidak ditemukan dalam respons /authenticateUser.');
            console.log('[Bot Detail] Respons penuh /authenticateUser:', JSON.stringify(r2.data, null, 2));
            return null;
        }
        // console.log(`[Bot Detail] Mendapatkan customAuthToken (awal): ${customAuthToken.substring(0, 30)}...`); // User commented this out

        // console.log('[Bot Detail] Mencoba panggilan API Firebase signInWithCustomToken...'); // User commented this out
        const r3 = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
            { token: customAuthToken, returnSecureToken: true },
            configForR2AndR3
        );
        // console.log('[Bot Detail] Status respons Firebase signInWithCustomToken:', r3.status); // User commented this out

        const idToken = r3.data?.idToken;
        if (!idToken) {
            console.log('[Bot Detail] idToken tidak ditemukan dalam respons Firebase.');
            console.log('[Bot Detail] Respons penuh Firebase:', JSON.stringify(r3.data, null, 2));
            return null;
        }
        // console.log(`[Bot Detail] Berhasil mendapatkan Firebase idToken (awal): ${idToken.substring(0, 30)}...`); // User commented this out
        return idToken;

    } catch (error) {
        console.error('[Bot Detail] Error selama urutan panggilan API di getFirebaseIdTokenFromLink:', error.message);
        if (error.response) {
            console.error('[Bot Detail] Status respons error:', error.response.status);
            console.error('[Bot Detail] Data respons error:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error('[Bot Detail] Permintaan error dibuat tetapi tidak ada respons yang diterima (mungkin timeout atau masalah jaringan):', error.code);
        } else {
            console.error('[Bot Detail] Error saat menyiapkan permintaan:', error.message);
        }
        return null;
    }
}

async function performSingleRedeemAttempt(firebaseToken, packagingCode, originalLink, attemptNumber) {
    const config = {
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', 'authorization': `Bearer ${firebaseToken}` },
        httpsAgent: mainProxyAgent,
        timeout: 20000
    };
    const payload = { 'data': { 'publicCode': GRIVY_CAMPAIGN_PUBLIC_CODE, 'packagingCode': packagingCode, 'terms_conditions_01': true, 'terms_conditions_02': false, 'terms_conditions_03': false, 'domain': DEFAULT_DOMAIN } };
    let result = { attempt: attemptNumber, voucherCode: packagingCode, originalLink, stage: 'redeem', success: false, reward: "Campaign Tdk Diketahui (Redeem Gagal)" };
    try {
        const response = await axios.post('https://api-v1.grivy.com/grabMainRedeem', payload, config);
        if (response.data?.result) {
            result.success = true;
            result.redeemData = response.data.result;
            result.reward = response.data.result.campaign_public_settings?.public_name || "Campaign (Redeem Sukses)";
        } else {
            result.error = response.data?.error?.message || "Redeem gagal, tidak ada 'result'.";
            const el = result.error.toLowerCase();
            if (el.includes("limit_daily")) result.type = "coupons_limit_daily"; else if (el.includes("no_available_coupons")) result.type = "no_available_coupons"; else if (el.includes("packaging_code_used")) result.type = "packaging_code_used"; else result.type = "redeem_error_no_result";
        }
    } catch (error) {
        result.error = error.response?.data?.error?.message || error.message || "Error request redeem";
        const el = String(result.error).toLowerCase();
        if (error.code === 'ECONNABORTED' || el.includes('timeout')) result.type = "timeout_redeem"; else if (el.includes("limit_daily")) result.type = "coupons_limit_daily"; else if (el.includes("no_available_coupons")) result.type = "no_available_coupons"; else if (el.includes("packaging_code_used")) result.type = "packaging_code_used"; else result.type = "network_or_unknown_redeem_error";
    }
    return result;
}

async function performSingleClaimAttempt(firebaseToken, redeemSuccessPayload, originalLink, voucherCode, redeemCampaignName, redeemAttemptNumber) {
    const config = {
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', 'authorization': `Bearer ${firebaseToken}`, 'origin': 'https://ayo.coca-cola.co.id', 'referer': 'https://ayo.coca-cola.co.id/' },
        timeout: 20000,
        httpsAgent: mainProxyAgent 
    };
    const payload = { "data": { "terms_conditions_01": null, "terms_conditions_02": null, "terms_conditions_03": null, "latitude": -6.9181652, "longitude": 106.93152, "plusCode": "6P583WJJ+PJ", "coupon": redeemSuccessPayload, "domain": DEFAULT_DOMAIN } };
    let result = { attempt: redeemAttemptNumber, voucherCode, originalLink, stage: 'claim', success: false, reward: redeemCampaignName };
    try {
        const response = await axios.post('https://us-central1-grivy-barcode.cloudfunctions.net/claimCoupon', payload, config);
        if (response.data?.result?.code) {
            result.success = true;
            result.claimedVoucherCode = response.data.result.code;
        } else {
            result.error = response.data?.error?.message || "Claim gagal, tidak ada kode voucher di hasil.";
            result.type = "claim_error_no_code";
        }
    } catch (error) {
        result.error = error.response?.data?.error?.message || error.message || "Error request claim";
        const el = String(result.error).toLowerCase();
        result.type = error.code === 'ECONNABORTED' || el.includes('timeout') ? "timeout_claim" : "network_or_unknown_claim_error";
    }
    return result;
}

function displayResults(outputCollector, activeColors, allRedeemResults, allClaimResults, inputVoucherCode, inputLink, durationInSeconds, numInitialRedeemAttempts) {
    outputCollector.push(`\n${activeColors.cyan}🎉 Hasil Proses untuk Kode: ${inputVoucherCode} | Link: ${inputLink}${activeColors.reset}`);
    // outputCollector.push(`Total Percobaan Awal Redeem direncanakan: ${numInitialRedeemAttempts}`); // User commented this

    const successfulRedeems = allRedeemResults.filter(r => r.success);
    // const failedRedeems = allRedeemResults.filter(r => !r.success && r.stage === 'redeem'); // User commented this section out
    // const systemErrorRedeems = allRedeemResults.filter(r => r.stage === 'redeem_system_error');

    // outputCollector.push(`\n${activeColors.yellow}--- FASE 1: HASIL REDEEM (${allRedeemResults.length} percobaan) ---${activeColors.reset}`); // User commented this
    // outputCollector.push(`${activeColors.green}Redeem Sukses: ${successfulRedeems.length}${activeColors.reset}`); // User commented this
    // outputCollector.push(`${activeColors.red}Redeem Gagal (API Error): ${failedRedeems.length}${activeColors.reset}`); // User commented this

    // if (failedRedeems.length > 0) { ... } // User commented this
    // if (systemErrorRedeems.length > 0) { ... } // User commented this

    const successfulClaims = allClaimResults.filter(r => r.success && r.stage === 'claim');
    const failedApiClaims = allClaimResults.filter(r => !r.success && r.stage === 'claim');
    const systemErrorClaims = allClaimResults.filter(r => r.stage === 'claim_system_error');
    const skippedByFilterClaims = allClaimResults.filter(r => r.stage === 'claim_skipped'); // <-- Untuk menghitung yang di-skip

    const actualClaimAttemptsCount = allClaimResults.filter(r => r.stage === 'claim' || r.stage === 'claim_system_error').length;

    outputCollector.push(`\n${activeColors.yellow}HASIL CLAIM (${actualClaimAttemptsCount} percobaan dari ${successfulRedeems.length} redeem sukses, ${skippedByFilterClaims.length} dilewati filter) ---${activeColors.reset}`);
    if (successfulRedeems.length > 0 || allClaimResults.length > 0) { // Tampilkan bagian ini jika ada redeem sukses ATAU ada hasil claim (termasuk yang di-skip)
        outputCollector.push(`${activeColors.green}Claim Sukses (Voucher Didapat): ${successfulClaims.length}${activeColors.reset}`);
        successfulClaims.forEach(claim => {
            outputCollector.push(`  ${activeColors.green}Dari Redeem #${claim.attempt}: ✅ ${claim.claimedVoucherCode} (${claim.reward})${activeColors.reset}`);
        });

        if (skippedByFilterClaims.length > 0) {
            outputCollector.push(`${activeColors.yellow}Claim Dilewati (Filter): ${skippedByFilterClaims.length}${activeColors.reset}`);
            skippedByFilterClaims.forEach(skip => {
                outputCollector.push(`  ${activeColors.yellow}Dari Redeem #${skip.attempt}: ⏭️ Dilewati karena reward '${skip.reward}'${activeColors.reset}`);
            });
        }

        outputCollector.push(`${activeColors.red}Claim Gagal (API Error): ${failedApiClaims.length}${activeColors.reset}`);
        if (failedApiClaims.length > 0) {
            const claimErrorCounts = {};
            failedApiClaims.forEach(fail => {
                const errorKey = fail.type || (fail.error ? String(fail.error).substring(0, 70) + (String(fail.error).length > 70 ? '...' : '') : 'Error Tidak Diketahui');
                claimErrorCounts[errorKey] = (claimErrorCounts[errorKey] || 0) + 1;
            });
            outputCollector.push(`  ${activeColors.red}Rincian Kegagalan Claim (API Error):${activeColors.reset}`);
            for (const errorKey in claimErrorCounts) {
                outputCollector.push(`    - ${activeColors.red}${errorKey}: ${claimErrorCounts[errorKey]} kali${activeColors.reset}`);
            }
        }
        if (systemErrorClaims.length > 0) {
            outputCollector.push(`${activeColors.magenta}Claim Gagal (System Error/Promise Ditolak): ${systemErrorClaims.length}${activeColors.reset}`);
        }
    } else {
        outputCollector.push("Tidak ada redeem yang sukses pada Fase 1, jadi tidak ada claim yang dilakukan.");
    }
    
    outputCollector.push(`\n${activeColors.yellow}⏰ Proses keseluruhan selesai dalam ${durationInSeconds} detik.${activeColors.reset}`);
}

async function runBot(manualVoucherCode, manualShortUrl, numAttempts = DEFAULT_NUM_SPAM_ATTEMPTS, forWebServer = false) {
    const outputCollector = [];
    const activeColors = forWebServer ? noColors : baseColors;

    if (FIREBASE_API_KEY === 'ISI_DENGAN_FIREBASE_API_KEY_ANDA') {
        const msg = `${activeColors.red}Kesalahan Konfigurasi: FIREBASE_API_KEY belum diisi di bot.js!${activeColors.reset}`;
        outputCollector.push(msg);
        if (forWebServer) throw new Error(stripAnsi(msg));
        return forWebServer ? stripAnsi(outputCollector.join('\n')) : outputCollector.join('\n');
    }

    const startTime = Date.now();

    if (!manualVoucherCode || !manualShortUrl) {
        const msg = `${activeColors.red}Kode voucher dan Link tidak boleh kosong. Keluar.${activeColors.reset}`;
        outputCollector.push(msg);
        if (forWebServer) throw new Error(stripAnsi(msg));
        return forWebServer ? stripAnsi(outputCollector.join('\n')) : outputCollector.join('\n');
    }

    // outputCollector.push(`${activeColors.cyan}Memulai proses untuk Kode: ${manualVoucherCode}, Link: ${manualShortUrl}, Percobaan: ${numAttempts}${activeColors.reset}`); // User commented
    // outputCollector.push(`${activeColors.yellow}Mencoba mendapatkan Firebase Token...${activeColors.reset}`); // User commented

    const firebaseToken = await getFirebaseIdTokenFromLink(manualShortUrl);

    if (!firebaseToken) {
        const msg = `${activeColors.red}Gagal mendapatkan Firebase ID Token untuk link ${manualShortUrl}. Periksa link, FIREBASE_API_KEY, atau coba lagi.${activeColors.reset}`;
        outputCollector.push(msg);
        if (forWebServer) throw new Error(stripAnsi(msg));
        return forWebServer ? stripAnsi(outputCollector.join('\n')) : outputCollector.join('\n');
    }
    // outputCollector.push(`${activeColors.green}Firebase ID Token berhasil didapatkan.${activeColors.reset}`); // User commented

    // outputCollector.push(`${activeColors.cyan}--- Fase 1: Melakukan ${numAttempts} Percobaan Redeem ---${activeColors.reset}`); // User commented
    const redeemPromises = [];
    for (let i = 0; i < numAttempts; i++) {
        redeemPromises.push(performSingleRedeemAttempt(firebaseToken, manualVoucherCode, manualShortUrl, i + 1));
    }
    const settledRedeemOutcomes = await Promise.allSettled(redeemPromises);

    const allRedeemResults = [];
    const successfulRedeemsForClaiming = [];

    settledRedeemOutcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
            allRedeemResults.push(outcome.value);
            if (outcome.value.success && outcome.value.redeemData) {
                successfulRedeemsForClaiming.push(outcome.value);
            }
        } else {
            allRedeemResults.push({
                attempt: index + 1, voucherCode: manualVoucherCode, originalLink: manualShortUrl,
                stage: 'redeem_system_error', success: false,
                error: `Promise redeem ditolak: ${outcome.reason?.message || String(outcome.reason)}`
            });
        }
    });
    // outputCollector.push(`${activeColors.green}Fase 1 (Redeem) Selesai. ${successfulRedeemsForClaiming.length} redeem berhasil dari ${allRedeemResults.length} percobaan.${activeColors.reset}`); // User commented

    const allClaimResults = []; // Ini akan diisi dengan hasil claim aktual, error sistem claim, dan item yang di-skip
    
    if (successfulRedeemsForClaiming.length > 0) {
        const redeemResultsToActuallyClaim = [];
        
        successfulRedeemsForClaiming.forEach((redeemResult) => {
            if (redeemResult.reward === REWARD_TO_SKIP_CLAIM) {
                const skipMsg = `${activeColors.yellow}Skipping claim untuk Redeem #${redeemResult.attempt} karena reward adalah '${REWARD_TO_SKIP_CLAIM}'.${activeColors.reset}`;
                outputCollector.push(skipMsg);
                allClaimResults.push({ // Tambahkan ke allClaimResults untuk dilacak
                    attempt: redeemResult.attempt,
                    voucherCode: redeemResult.voucherCode,
                    originalLink: redeemResult.originalLink,
                    stage: 'claim_skipped',
                    success: false, 
                    error: `Claim dilewati karena reward '${REWARD_TO_SKIP_CLAIM}'`,
                    reward: redeemResult.reward,
                    type: 'claim_filter_skip'
                });
            } else {
                redeemResultsToActuallyClaim.push(redeemResult);
            }
        });

        if (redeemResultsToActuallyClaim.length > 0) {
            outputCollector.push(`${activeColors.cyan}--- Fase 2: Melakukan ${redeemResultsToActuallyClaim.length} Percobaan Claim (dari ${successfulRedeemsForClaiming.length} redeem sukses) ---${activeColors.reset}`);
            const claimPromises = [];
            redeemResultsToActuallyClaim.forEach((redeemResult) => {
                claimPromises.push(
                    performSingleClaimAttempt(
                        firebaseToken, redeemResult.redeemData, redeemResult.originalLink,
                        redeemResult.voucherCode, redeemResult.reward, redeemResult.attempt
                    )
                );
            });
            const settledClaimOutcomes = await Promise.allSettled(claimPromises);

            settledClaimOutcomes.forEach((outcome, index) => {
                if (outcome.status === 'fulfilled') {
                    allClaimResults.push(outcome.value);
                } else { 
                    const originalRedeemContext = redeemResultsToActuallyClaim[index];
                    allClaimResults.push({
                        attempt: originalRedeemContext?.attempt || (index + 1), // Mungkin perlu penyesuaian index jika ada yang skip
                        voucherCode: originalRedeemContext?.voucherCode || manualVoucherCode,
                        originalLink: originalRedeemContext?.originalLink || manualShortUrl,
                        stage: 'claim_system_error',
                        success: false,
                        error: `Promise claim ditolak: ${outcome.reason?.message || String(outcome.reason)}`,
                        reward: originalRedeemContext?.reward || 'Unknown Campaign'
                    });
                }
            });
            // outputCollector.push(`${activeColors.green}Fase 2 (Claim) Selesai. ${allClaimResults.filter(c=>c.success && c.stage === 'claim').length} claim berhasil dari ${redeemResultsToActuallyClaim.length} percobaan.${activeColors.reset}`); // User commented
        } else if (successfulRedeemsForClaiming.length > 0) { // Jika ada redeem sukses, tapi semua di-skip
             outputCollector.push(`${activeColors.yellow}Semua redeem yang sukses (${successfulRedeemsForClaiming.length}) dilewati oleh filter, tidak ada claim yang dilakukan.${activeColors.reset}`);
        }

    } else {
        // outputCollector.push(`${activeColors.yellow}Tidak ada redeem yang berhasil pada Fase 1, Fase 2 (Claim) dilewati.${activeColors.reset}`); // User commented
    }

    const endTime = Date.now();
    const durationInSeconds = ((endTime - startTime) / 1000).toFixed(2);

    displayResults(outputCollector, activeColors, allRedeemResults, allClaimResults, manualVoucherCode, manualShortUrl, durationInSeconds, numAttempts);

    const successfulClaimDetailsToSave = allClaimResults
        .filter(r => r.stage === 'claim' && r.success && r.claimedVoucherCode)
        .map(claim => ({
            originalVoucherCode: claim.voucherCode,
            claimedVoucherCode: claim.claimedVoucherCode,
            reward: claim.reward,
            linkUsed: claim.originalLink,
            redeemAttemptNo: claim.attempt,
            timestamp: new Date().toISOString()
        }));

    if (successfulClaimDetailsToSave.length > 0) {
        await saveSuccessfulClaimsToJson(successfulClaimDetailsToSave, outputCollector, activeColors);
    } else {
        outputCollector.push(`${activeColors.yellow}Tidak ada klaim yang berhasil pada sesi ini.${activeColors.reset}`);
    }

    outputCollector.push(`\n${activeColors.cyan}Proses selesai final.${activeColors.reset}`);

    if (forWebServer) {
        return outputCollector.map(line => stripAnsi(line)).join('\n');
    }
    return outputCollector.join('\n');
}

module.exports = { runBot, DEFAULT_NUM_SPAM_ATTEMPTS };

if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        if (args.length < 2 || args.length > 3) {
            console.log(baseColors.red + "Penggunaan: node bot.js <shortUrl> <voucherCode> [numAttempts]" + baseColors.reset);
            console.log(baseColors.yellow + "Contoh   : node bot.js https://ayo.coca-cola.co.id/s/xxxxxxx KODEANDA123 50" + baseColors.reset);
            process.exit(1);
        }

        const manualShortUrl = args[0];
        const manualVoucherCode = args[1];
        const numAttemptsArg = args[2];
        let numAttemptsCLI = DEFAULT_NUM_SPAM_ATTEMPTS;

        if (numAttemptsArg !== undefined) {
            const parsedAttempts = parseInt(numAttemptsArg, 10);
            if (!isNaN(parsedAttempts) && parsedAttempts > 0) {
                numAttemptsCLI = parsedAttempts;
            } else {
                console.log(baseColors.yellow + `Jumlah percobaan tidak valid: "${numAttemptsArg}". Menggunakan default: ${DEFAULT_NUM_SPAM_ATTEMPTS}` + baseColors.reset);
            }
        }

        if (FIREBASE_API_KEY === 'ISI_DENGAN_FIREBASE_API_KEY_ANDA') {
            console.log(baseColors.red + "Kesalahan Konfigurasi: FIREBASE_API_KEY belum diisi di bot.js!" + baseColors.reset);
            process.exit(1);
        }

        console.log(baseColors.cyan + `Menjalankan bot dari CLI untuk URL: ${manualShortUrl}, Kode: ${manualVoucherCode}, Percobaan: ${numAttemptsCLI}` + baseColors.reset);

        try {
            const resultString = await runBot(manualVoucherCode, manualShortUrl, numAttemptsCLI, false);
            console.log(resultString);
        } catch (cliError) {
            console.error(baseColors.red + "Terjadi error tidak terduga saat menjalankan bot dari CLI:", cliError.message + baseColors.reset);
            if (cliError.stack) {
                console.error(cliError.stack);
            }
        }
    })();
}