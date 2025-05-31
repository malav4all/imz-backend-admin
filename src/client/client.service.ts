import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client, ClientDocument } from './schema/client.schema';
import {
  CreateClientDto,
  SearchClientDto,
  UpdateClientDto,
} from './dto/create-client.dto';
import { PaginatedResponse } from 'src/comman/pagination.dto';
import { Response } from 'express';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';

@Injectable()
export class ClientService {
  constructor(
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
  ) {}

  async create(createClientDto: CreateClientDto): Promise<Client> {
    try {
      const createdClient = new this.clientModel(createClientDto);
      return await createdClient.save();
    } catch (error) {
      if (error.code === 11000) {
        const duplicateField = Object.keys(error.keyValue)[0];
        throw new ConflictException(`${duplicateField} already exists`);
      }
      throw error;
    }
  }

  async findAll(
    searchDto: SearchClientDto,
  ): Promise<PaginatedResponse<Client>> {
    const { searchText, page = 1, limit = 10 } = searchDto;
    const skip = (page - 1) * limit;

    let filter = {};

    if (searchText && searchText.trim()) {
      const searchRegex = new RegExp(searchText.trim(), 'i');
      filter = {
        $or: [
          { name: searchRegex },
          { contactName: searchRegex },
          { email: searchRegex },
          { contactNo: searchRegex },
          { panNumber: searchRegex },
          { aadharNumber: searchRegex },
          { gstNumber: searchRegex },
          { stateName: searchRegex },
          { cityName: searchRegex },
          { remark: searchRegex },
        ],
      };
    }

    const [clients, total] = await Promise.all([
      this.clientModel.find(filter).skip(skip).limit(limit).exec(),
      this.clientModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(clients, page, limit, total);
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.clientModel.findById(id).exec();
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  async update(id: string, updateClientDto: UpdateClientDto): Promise<Client> {
    try {
      const updatedClient = await this.clientModel
        .findByIdAndUpdate(id, updateClientDto, { new: true })
        .exec();

      if (!updatedClient) {
        throw new NotFoundException('Client not found');
      }

      return updatedClient;
    } catch (error) {
      if (error.code === 11000) {
        const duplicateField = Object.keys(error.keyValue)[0];
        throw new ConflictException(`${duplicateField} already exists`);
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const result = await this.clientModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Client not found');
    }
  }

  async findAllWithoutPagination(): Promise<Client[]> {
    try {
      const clients = await this.clientModel.find().exec();
      return clients;
    } catch (error) {
      throw error;
    }
  }

  exportToPDF(clients: Client[], res: Response): void {
    try {
      // Create a document with margins
      const doc = new PDFDocument({ margin: 30 });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=clients.pdf');

      doc.pipe(res);

      // Title
      doc.fontSize(18).text('Client List', { align: 'center' }).moveDown(1);

      // Define table structure
      const table = {
        headers: [
          { label: 'Name', width: 100 },
          { label: 'Contact Name', width: 80 },
          { label: 'Email', width: 120 },
          { label: 'Contact No', width: 80 },
          { label: 'State', width: 80 },
          { label: 'City', width: 80 },
        ],
        rows: clients.map((client) => [
          client.name || '',
          client.contactName || '',
          client.email || '',
          client.contactNo || '',
          client.stateName || '',
          client.cityName || '',
        ]),
        rowHeight: 25,
        margin: { top: 40 },
      };

      // Table drawing position
      const startY = doc.y + table.margin.top;
      let currentY = startY;

      // Draw table headers
      doc.font('Helvetica-Bold').fontSize(10);
      let x = doc.page.margins.left;

      table.headers.forEach((header, i) => {
        doc.text(header.label, x, currentY, {
          width: header.width,
          align: 'left',
        });
        x += header.width;
      });

      currentY += table.rowHeight;

      // Draw horizontal line under headers
      doc
        .moveTo(doc.page.margins.left, currentY - 5)
        .lineTo(doc.page.width - doc.page.margins.right, currentY - 5)
        .stroke();

      // Draw table rows
      doc.font('Helvetica').fontSize(10);

      table.rows.forEach((row, rowIndex) => {
        x = doc.page.margins.left;
        let maxHeightInRow = 0;

        // Draw each cell in the row
        row.forEach((cell, colIndex) => {
          const cellHeight = doc.heightOfString(cell, {
            width: table.headers[colIndex].width,
          });

          maxHeightInRow = Math.max(maxHeightInRow, cellHeight);

          doc.text(cell, x, currentY, {
            width: table.headers[colIndex].width,
            align: 'left',
          });

          x += table.headers[colIndex].width;
        });

        currentY += maxHeightInRow + 10;

        // Add a new page if we're at the bottom
        if (currentY > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          currentY = doc.page.margins.top;
        }
      });

      doc.end();
    } catch (error) {
      console.error('Error in exportToPDF:', error);
      if (!res.headersSent) {
        res.status(500).send('Error generating PDF');
      }
    }
  }

  exportToCSV(clients: Client[], res: Response): void {
    try {
      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=clients_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Name',
          'Contact Name',
          'Email',
          'Contact No',
          'PAN Number',
          'Aadhar Number',
          'GST Number',
          'State Name',
          'City Name',
          'Remark',
        ],
        writeHeaders: true,
        delimiter: ',',
        quote: '"',
        escape: '"',
        includeEndRowDelimiter: true,
      });

      // Pipe CSV stream to response
      csvStream.pipe(res);

      // Write data rows
      clients.forEach((client) => {
        csvStream.write({
          Name: client.name || 'N/A',
          'Contact Name': client.contactName || 'N/A',
          Email: client.email || 'N/A',
          'Contact No': client.contactNo || 'N/A',
          'PAN Number': client.panNumber || 'N/A',
          'Aadhar Number': client.aadharNumber || 'N/A',
          'GST Number': client.gstNumber || 'N/A',
          'State Name': client.stateName || 'N/A',
          'City Name': client.cityName || 'N/A',
          Remark: client.remark || 'N/A',
        });
      });

      // Handle stream events
      csvStream.on('error', (error) => {
        console.error('CSV stream error:', error);
        if (!res.headersSent) {
          res.status(500).send('Error generating CSV');
        }
      });

      csvStream.on('end', () => {
        console.log('CSV export completed successfully');
      });

      csvStream.end();
    } catch (error) {
      console.error('Error in exportToCSV:', error);
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
      }
    }
  }

  async exportToXLSX(clients: Client[], res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Client Management System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Clients', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Contact Name', key: 'contactName', width: 20 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Contact No', key: 'contactNo', width: 15 },
        { header: 'PAN Number', key: 'panNumber', width: 15 },
        { header: 'Aadhar Number', key: 'aadharNumber', width: 18 },
        { header: 'GST Number', key: 'gstNumber', width: 20 },
        { header: 'State Name', key: 'stateName', width: 15 },
        { header: 'City Name', key: 'cityName', width: 15 },
        { header: 'Remark', key: 'remark', width: 30 },
        {
          header: 'Created At',
          key: 'createdAt',
          width: 20,
          style: { numFmt: 'yyyy-mm-dd hh:mm:ss' },
        },
        {
          header: 'Updated At',
          key: 'updatedAt',
          width: 20,
          style: { numFmt: 'yyyy-mm-dd hh:mm:ss' },
        },
      ];

      // Add header style
      worksheet.getRow(1).eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }, // Blue background
        };
        cell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' }, // White text
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Add data rows
      clients.forEach((client) => {
        const row = worksheet.addRow({
          name: client.name || 'N/A',
          contactName: client.contactName || 'N/A',
          email: client.email || 'N/A',
          contactNo: client.contactNo || 'N/A',
          panNumber: client.panNumber || 'N/A',
          aadharNumber: client.aadharNumber || 'N/A',
          gstNumber: client.gstNumber || 'N/A',
          stateName: client.stateName || 'N/A',
          cityName: client.cityName || 'N/A',
          remark: client.remark || 'N/A',
          // createdAt: client.createdAt,
          // updatedAt: client.updatedAt,
        });

        // Style the data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        });
      });

      // Freeze header row
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      // Auto-filter
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columnCount },
      };

      // Set response headers
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=clients_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Error exporting to XLSX:', error);
      if (!res.headersSent) {
        res.status(500).send('Error generating Excel file');
      }
    }
  }
}
