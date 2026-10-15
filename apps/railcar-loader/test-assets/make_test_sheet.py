"""Builds vin-test-sheet.pdf: printable VINs for testing the scanner and PDF upload.

Run: python3 make_test_sheet.py  (requires reportlab)
All VINs have correct check digits and decode with NHTSA, except the one
entry deliberately marked as a bad check digit.
"""
import json
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.graphics.barcode.code39 import Standard39
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.barcode import createBarcodeDrawing
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

HERE = Path(__file__).parent
OUT = HERE / 'vin-test-sheet.pdf'
LAYOUT = HERE / 'vin-test-sheet-layout.json'

# (vehicle, [barcode VIN, text VIN, 2D-code VIN])
VEHICLES = [
    ('2022 Ford F-150', ['1FTFW1E5XNF100000', '1FTFW1E51NF100001', '1FTFW1E53NF100002']),
    ('2026 Chevrolet Equinox EV', ['3GN7DNRP4TS101000', '3GN7DNRP6TS101001', '3GN7DNRP8TS101002']),
    ('2020 Toyota Camry', ['4T1B11HK1LU102000', '4T1B11HK3LU102001', '4T1B11HK5LU102002']),
    ('2019 Honda Civic', ['2HGFC2F68KH103000', '2HGFC2F6XKH103001', '2HGFC2F61KH103002']),
    ('2021 Tesla Model 3', ['5YJ3E1EA7MF104000', '5YJ3E1EA9MF104001', '5YJ3E1EA0MF104002']),
    ('2021 Ram 1500', ['1C6SRFFT4MN105000', '1C6SRFFT6MN105001', '1C6SRFFT8MN105002']),
    ('2020 Jeep Grand Cherokee', ['1C4RJFAG5LC106000', '1C4RJFAG7LC106001', '1C4RJFAG9LC106002']),
    ('2021 Chevrolet Silverado', ['1GCUYDED9MZ107000', '1GCUYDED0MZ107001', '1GCUYDED2MZ107002']),
    ('2021 Nissan Rogue', ['JN8AT3BB8MW108000', 'JN8AT3BBXMW108001', 'JN8AT3BB1MW108002']),
    ('2021 Toyota RAV4', ['2T3P1RFV9MC109000', '2T3P1RFV0MC109001', '2T3P1RFV2MC109002']),
    ('2021 Ford Explorer', ['1FMSK8DH1MG110000', '1FMSK8DH3MG110001', '1FMSK8DH5MG110002']),
    ('2021 Chevrolet Suburban', ['1GNSKBKD6MR111000', '1GNSKBKD8MR111001', '1GNSKBKDXMR111002']),
]
BAD_CHECK_DIGIT = '1FTFW1E57NF100003'  # correct check digit would differ

W, H = letter
M = 40
INK = (0.11, 0.14, 0.19)
MUTED = (0.37, 0.41, 0.47)
RULE = (0.85, 0.87, 0.9)
PLATE = (0.9, 0.91, 0.92)
layout = []


def header(c, page, title, subtitle):
    c.setFillColorRGB(*INK)
    c.setFont('Helvetica-Bold', 16)
    c.drawString(M, H - M - 6, 'Railcar Loader · VIN Test Sheet')
    c.setFont('Helvetica', 9)
    c.setFillColorRGB(*MUTED)
    c.drawRightString(W - M, H - M - 6, f'Page {page} of 3')
    c.setStrokeColorRGB(*RULE)
    c.line(M, H - M - 16, W - M, H - M - 16)
    c.setFillColorRGB(*INK)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(M, H - M - 38, title)
    c.setFont('Helvetica', 9)
    c.setFillColorRGB(*MUTED)
    y = H - M - 52
    for line in subtitle:
        c.drawString(M, y, line)
        y -= 12
    return y - 8


def label(c, x, y, n, vehicle):
    c.setFillColorRGB(*MUTED)
    c.setFont('Helvetica-Bold', 8)
    c.drawString(x, y, f'#{n}')
    c.setFont('Helvetica', 8)
    c.drawString(x + 22, y, vehicle)


def record(page, kind, vin, x, y, w, h):
    # Bounding box in PDF points, origin bottom-left, for automated checks.
    layout.append({'page': page, 'kind': kind, 'vin': vin, 'box': [x, y, w, h]})


def page_barcodes(c):
    y0 = header(c, 1, 'A. Barcodes (like door-jamb and window stickers)', [
        'Open the camera scanner and point it at each barcode. Each should be added automatically with a beep.',
        'Code 39, the format used on most VIN labels.',
    ])
    col_w = (W - 2 * M) / 2
    row_h = 100
    for i, (vehicle, vins) in enumerate(VEHICLES):
        col, row = i % 2, i // 2
        x = M + col * col_w
        y = y0 - row * row_h
        vin = vins[0]
        label(c, x, y - 10, i + 1, vehicle)
        bc = Standard39(vin, barWidth=0.85, barHeight=42, ratio=3, checksum=0, quiet=1, lquiet=10, rquiet=10)
        bc.drawOn(c, x - 10, y - 62)
        record(1, 'code39', vin, x - 10, y - 62, bc.width, bc.height)
        c.setFillColorRGB(*INK)
        c.setFont('Courier-Bold', 11)
        c.drawString(x, y - 76, vin)
    c.showPage()


def page_text_and_2d(c):
    y0 = header(c, 2, 'B. Printed VIN text (like a windshield VIN plate)', [
        'Point the scanner at the text. Clean reads are added automatically; otherwise the app asks you to confirm.',
        'You can also tap Capture.',
    ])
    col_w = (W - 2 * M) / 2
    row_h = 52
    for i, (vehicle, vins) in enumerate(VEHICLES):
        col, row = i % 2, i // 2
        x = M + col * col_w
        y = y0 - row * row_h
        vin = vins[1]
        label(c, x, y - 10, i + 13, vehicle)
        c.setFillColorRGB(*PLATE)
        c.roundRect(x, y - 42, col_w - 24, 26, 4, stroke=0, fill=1)
        c.setFillColorRGB(*INK)
        c.setFont('Courier-Bold', 15)
        c.drawString(x + 10, y - 34, vin)
        record(2, 'text', vin, x, y - 42, col_w - 24, 26)

    y = y0 - 6 * row_h - 18
    c.setStrokeColorRGB(*RULE)
    c.line(M, y + 8, W - M, y + 8)
    c.setFillColorRGB(*INK)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(M, y - 10, 'C. 2D codes (QR and Data Matrix)')
    c.setFont('Helvetica', 9)
    c.setFillColorRGB(*MUTED)
    c.drawString(M, y - 24, 'Some labels and shipping papers use these. Odd numbers are QR codes, even numbers are Data Matrix.')
    y -= 40
    cell = (W - 2 * M) / 6
    for i, (vehicle, vins) in enumerate(VEHICLES):
        col, row = i % 6, i // 6
        x = M + col * cell
        yy = y - row * 128
        vin = vins[2]
        size = 66
        if i % 2 == 0:
            widget = QrCodeWidget(vin, barLevel='M')
            b = widget.getBounds()
            d = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
            d.add(widget)
            renderPDF.draw(d, c, x, yy - 10 - size)
            kind = 'qr'
        else:
            dm = createBarcodeDrawing('ECC200DataMatrix', value=vin, barWidth=size / 44)
            renderPDF.draw(dm, c, x, yy - 10 - size)
            kind = 'datamatrix'
        record(2, kind, vin, x - 4, yy - 18 - size, size + 16, size + 16)
        c.setFillColorRGB(*MUTED)
        c.setFont('Helvetica-Bold', 8)
        c.drawString(x, yy, f'#{i + 25}')
        c.setFont('Helvetica', 7)
        c.drawString(x, yy - 90, vehicle.split(' ', 1)[1][:20])
        c.setFont('Courier', 6.5)
        c.drawString(x, yy - 99, vin)
    c.showPage()


def page_list(c):
    y = header(c, 3, 'D. Full VIN list (upload test)', [
        'Upload this PDF on the Vehicles tab ("Upload a file"). The app should find all 37 VINs on this sheet.',
        'Expected: 36 decode to the vehicles below, and #37 is flagged with a check digit warning.',
    ])
    c.setFont('Helvetica-Bold', 8)
    c.setFillColorRGB(*MUTED)
    cols = [M, M + 28, M + 180, M + 330]
    for x, t in zip(cols, ['#', 'VIN', 'Vehicle', 'Section']):
        c.drawString(x, y, t)
    y -= 6
    rows = []
    sections = ['A. Barcode', 'B. Printed text', 'C. 2D code']
    for s in range(3):
        for i, (vehicle, vins) in enumerate(VEHICLES):
            rows.append((s * 12 + i + 1, vins[s], vehicle, sections[s]))
    rows.append((37, BAD_CHECK_DIGIT, '2022 Ford F-150', 'Bad check digit (expect a warning)'))
    for n, vin, vehicle, section in rows:
        y -= 13
        c.setStrokeColorRGB(*RULE)
        c.line(M, y - 3, W - M, y - 3)
        c.setFillColorRGB(*INK)
        c.setFont('Helvetica', 8)
        c.drawString(cols[0], y, str(n))
        c.setFont('Courier-Bold', 9)
        c.drawString(cols[1], y, vin)
        c.setFont('Helvetica', 8)
        c.drawString(cols[2], y, vehicle)
        c.setFillColorRGB(*MUTED)
        c.drawString(cols[3], y, section)
    y -= 26
    c.setFillColorRGB(*INK)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(M, y, 'Expected vehicle summary after upload: 3 of each of the 12 models above (4 F-150s including #37).')
    c.showPage()


def main():
    c = canvas.Canvas(str(OUT), pagesize=letter)
    c.setTitle('Railcar Loader VIN Test Sheet')
    c.setAuthor('Railcar Loader')
    page_barcodes(c)
    page_text_and_2d(c)
    page_list(c)
    c.save()
    LAYOUT.write_text(json.dumps(layout, indent=1))
    print(f'Wrote {OUT}')


if __name__ == '__main__':
    main()
