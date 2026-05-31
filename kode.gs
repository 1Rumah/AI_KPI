function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('PT ICC - AI Executive Dashboard 3D')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function getSheetRawData(sheetName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(); // Pastikan script terikat pada Spreadsheet Buku_Besar_PT_ICC
    if (!ss) throw new Error("Spreadsheet tidak ditemukan.");
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    
    // Mengambil data mentah (2D Array) karena posisi baris header bervariasi tiap sheet
    var values = sheet.getDataRange().getDisplayValues();
    return values;
  } catch (e) {
    Logger.log("Error pada sheet [" + sheetName + "]: " + e.message);
    return [];
  }
}

function getAllDashboardData() {
  try {
    // Daftar sheet yang diminta dari Buku_Besar_PT_ICC
    var targetSheets = [
      "Piutang_Pengrajin", "Hutang", "Piutang_Penjualan", "Pinjaman_Karyawan", 
      "Pinjaman_Pengrajin", "Pinjaman_Owner", "Pengrajin_Piutang", "Kasbon", 
      "Bulanan", "Bank_BRI", "PENJUALAN", "PEMBELIAN", "Bahan_Baku", "PETTY_CASH"
    ];
    
    var compiledData = {};
    for (var i = 0; i < targetSheets.length; i++) {
      compiledData[targetSheets[i]] = getSheetRawData(targetSheets[i]);
    }

    return {
      status: "success",
      data: compiledData
    };
  } catch (err) {
    return {
      status: "error",
      message: err.message
    };
  }
}
