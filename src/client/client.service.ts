import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
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
import axios from 'axios';

@Injectable()
export class ClientService {
  private readonly logger = new Logger(ClientService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:9008/logs';

  constructor(
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
  ) {}

  async create(
    createClientDto: CreateClientDto,
    userId?: string,
  ): Promise<Client> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Creating client with data: ${JSON.stringify(createClientDto)}`,
      );

      const createdClient = new this.clientModel(createClientDto);
      const savedClient = await createdClient.save();

      // 📝 Log successful creation
      await this.sendLog({
        method: 'POST',
        url: '/api/clients',
        statusCode: 201,
        operation: 'CREATE',
        resource: 'CLIENT',
        message: `Client created successfully: ${savedClient.name}`,
        userId,
        metadata: {
          clientId: savedClient._id,
          clientName: savedClient.name,
          email: savedClient.email,
          requestData: createClientDto,
        },
        responseTime: Date.now() - startTime,
      });

      return savedClient;
    } catch (error) {
      let statusCode = 500;
      let errorMessage = error.message;

      if (error.code === 11000) {
        statusCode = 409;
        const duplicateField = Object.keys(error.keyValue)[0];
        errorMessage = `${duplicateField} already exists`;
      }

      // 📝 Log error
      await this.sendLog({
        method: 'POST',
        url: '/api/clients',
        statusCode,
        operation: 'CREATE',
        resource: 'CLIENT',
        message: `Client creation failed: ${errorMessage}`,
        userId,
        metadata: {
          requestData: createClientDto,
          errorType: error.code === 11000 ? 'DUPLICATE_ENTRY' : error.name,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to create client: ${errorMessage}`,
        error.stack,
      );

      if (error.code === 11000) {
        const duplicateField = Object.keys(error.keyValue)[0];
        throw new ConflictException(`${duplicateField} already exists`);
      }

      throw error;
    }
  }

  async findAll(
    searchDto: SearchClientDto,
    userId?: string,
  ): Promise<PaginatedResponse<Client>> {
    const startTime = Date.now();

    try {
      const { searchText, page = 1, limit = 10 } = searchDto;
      const skip = (page - 1) * limit;

      this.logger.log(
        `Retrieving clients - Page: ${page}, Limit: ${limit}, Search: ${searchText}`,
      );

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

      const paginatedResponse = new PaginatedResponse(
        clients,
        page,
        limit,
        total,
      );

      this.logger.log(
        `Retrieved ${clients.length} clients out of ${total} total clients`,
      );

      // 📝 Log successful retrieval
      await this.sendLog({
        method: 'GET',
        url: '/api/clients',
        statusCode: 200,
        operation: 'READ',
        resource: 'CLIENT',
        message: `Successfully retrieved ${clients.length} clients`,
        userId,
        metadata: {
          page,
          limit,
          searchText,
          retrievedCount: clients.length,
          totalCount: total,
        },
        responseTime: Date.now() - startTime,
      });

      return paginatedResponse;
    } catch (error) {
      // 📝 Log error
      await this.sendLog({
        method: 'GET',
        url: '/api/clients',
        statusCode: 500,
        operation: 'READ',
        resource: 'CLIENT',
        message: `Failed to retrieve clients: ${error.message}`,
        userId,
        metadata: {
          page: searchDto.page,
          limit: searchDto.limit,
          searchText: searchDto.searchText,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to retrieve clients: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findOne(id: string, userId?: string): Promise<Client> {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding client with ID: ${id}`);

      const client = await this.clientModel.findById(id).exec();

      if (!client) {
        this.logger.warn(`No client found with ID: ${id}`);

        // 📝 Log not found
        await this.sendLog({
          method: 'GET',
          url: `/api/clients/${id}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'CLIENT',
          message: `Client not found with ID: ${id}`,
          userId,
          metadata: { clientId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Client not found');
      }

      this.logger.log(`Client found with ID: ${id}`);

      // 📝 Log successful find
      await this.sendLog({
        method: 'GET',
        url: `/api/clients/${id}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'CLIENT',
        message: `Client found successfully`,
        userId,
        metadata: {
          clientId: id,
          clientName: client.name,
          email: client.email,
        },
        responseTime: Date.now() - startTime,
      });

      return client;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error; // Re-throw NotFoundException as is
      }

      // 📝 Log error
      await this.sendLog({
        method: 'GET',
        url: `/api/clients/${id}`,
        statusCode: 500,
        operation: 'READ',
        resource: 'CLIENT',
        message: `Failed to find client: ${error.message}`,
        userId,
        metadata: { clientId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to find client with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async update(
    id: string,
    updateClientDto: UpdateClientDto,
    userId?: string,
  ): Promise<Client> {
    const startTime = Date.now();

    try {
      this.logger.log(`Updating client with ID: ${id}`);

      const updatedClient = await this.clientModel
        .findByIdAndUpdate(id, updateClientDto, { new: true })
        .exec();

      if (!updatedClient) {
        this.logger.warn(`No client found to update with ID: ${id}`);

        // 📝 Log not found
        await this.sendLog({
          method: 'PUT',
          url: `/api/clients/${id}`,
          statusCode: 404,
          operation: 'UPDATE',
          resource: 'CLIENT',
          message: `Client not found for update with ID: ${id}`,
          userId,
          metadata: {
            clientId: id,
            updateData: updateClientDto,
          },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Client not found');
      }

      this.logger.log(`Client updated successfully with ID: ${id}`);

      // 📝 Log successful update
      await this.sendLog({
        method: 'PUT',
        url: `/api/clients/${id}`,
        statusCode: 200,
        operation: 'UPDATE',
        resource: 'CLIENT',
        message: `Client updated successfully: ${updatedClient.name}`,
        userId,
        metadata: {
          clientId: id,
          clientName: updatedClient.name,
          email: updatedClient.email,
          updateData: updateClientDto,
        },
        responseTime: Date.now() - startTime,
      });

      return updatedClient;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error; // Re-throw NotFoundException as is
      }

      let statusCode = 500;
      let errorMessage = error.message;

      if (error.code === 11000) {
        statusCode = 409;
        const duplicateField = Object.keys(error.keyValue)[0];
        errorMessage = `${duplicateField} already exists`;
      }

      // 📝 Log error
      await this.sendLog({
        method: 'PUT',
        url: `/api/clients/${id}`,
        statusCode,
        operation: 'UPDATE',
        resource: 'CLIENT',
        message: `Client update failed: ${errorMessage}`,
        userId,
        metadata: {
          clientId: id,
          updateData: updateClientDto,
          errorType: error.code === 11000 ? 'DUPLICATE_ENTRY' : error.name,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to update client with ID ${id}: ${errorMessage}`,
        error.stack,
      );

      if (error.code === 11000) {
        const duplicateField = Object.keys(error.keyValue)[0];
        throw new ConflictException(`${duplicateField} already exists`);
      }

      throw error;
    }
  }

  async remove(id: string, userId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Deleting client with ID: ${id}`);

      const result = await this.clientModel.findByIdAndDelete(id).exec();

      if (!result) {
        this.logger.warn(`No client found to delete with ID: ${id}`);

        // 📝 Log not found
        await this.sendLog({
          method: 'DELETE',
          url: `/api/clients/${id}`,
          statusCode: 404,
          operation: 'DELETE',
          resource: 'CLIENT',
          message: `Client not found for deletion with ID: ${id}`,
          userId,
          metadata: { clientId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Client not found');
      }

      this.logger.log(`Client deleted successfully with ID: ${id}`);

      // 📝 Log successful deletion
      await this.sendLog({
        method: 'DELETE',
        url: `/api/clients/${id}`,
        statusCode: 200,
        operation: 'DELETE',
        resource: 'CLIENT',
        message: `Client deleted successfully: ${result.name}`,
        userId,
        metadata: {
          clientId: id,
          deletedClientName: result.name,
          deletedClientEmail: result.email,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error; // Re-throw NotFoundException as is
      }

      // 📝 Log error
      await this.sendLog({
        method: 'DELETE',
        url: `/api/clients/${id}`,
        statusCode: 500,
        operation: 'DELETE',
        resource: 'CLIENT',
        message: `Client deletion failed: ${error.message}`,
        userId,
        metadata: { clientId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to delete client with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAllWithoutPagination(userId?: string): Promise<Client[]> {
    const startTime = Date.now();

    try {
      this.logger.log('Retrieving all clients without pagination');

      const clients = await this.clientModel.find().exec();

      this.logger.log(`Retrieved all ${clients.length} clients`);

      // 📝 Log success
      await this.sendLog({
        method: 'GET',
        url: '/api/clients/all',
        statusCode: 200,
        operation: 'READ',
        resource: 'CLIENT',
        message: `Retrieved all ${clients.length} clients`,
        userId,
        metadata: { totalCount: clients.length },
        responseTime: Date.now() - startTime,
      });

      return clients;
    } catch (error) {
      // 📝 Log error
      await this.sendLog({
        method: 'GET',
        url: '/api/clients/all',
        statusCode: 500,
        operation: 'READ',
        resource: 'CLIENT',
        message: `Failed to retrieve all clients: ${error.message}`,
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to retrieve all clients: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  exportToPDF(clients: Client[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting PDF export for ${clients.length} clients`);

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

      // 📝 Log export success
      this.sendLog({
        method: 'GET',
        url: '/api/clients/export/pdf',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'CLIENT',
        message: `PDF export completed successfully`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          clientCount: clients.length,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log('PDF export completed successfully');
    } catch (error) {
      console.error('Error in exportToPDF:', error);

      // 📝 Log export error
      this.sendLog({
        method: 'GET',
        url: '/api/clients/export/pdf',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'CLIENT',
        message: `PDF export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          clientCount: clients.length,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Error generating PDF');
      }
    }
  }

  exportToCSV(clients: Client[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting CSV export for ${clients.length} clients`);

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

        // 📝 Log CSV error
        this.sendLog({
          method: 'GET',
          url: '/api/clients/export/csv',
          statusCode: 500,
          operation: 'EXPORT',
          resource: 'CLIENT',
          message: `CSV export failed: ${error.message}`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            clientCount: clients.length,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
        });

        if (!res.headersSent) {
          res.status(500).send('Error generating CSV');
        }
      });

      csvStream.on('end', () => {
        console.log('CSV export completed successfully');

        // 📝 Log export success
        this.sendLog({
          method: 'GET',
          url: '/api/clients/export/csv',
          statusCode: 200,
          operation: 'EXPORT',
          resource: 'CLIENT',
          message: `CSV export completed successfully`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            clientCount: clients.length,
          },
          responseTime: Date.now() - startTime,
        });
      });

      csvStream.end();
    } catch (error) {
      console.error('Error in exportToCSV:', error);

      // 📝 Log export error
      this.sendLog({
        method: 'GET',
        url: '/api/clients/export/csv',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'CLIENT',
        message: `CSV export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'CSV',
          clientCount: clients.length,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
      }
    }
  }

  async exportToXLSX(
    clients: Client[],
    res: Response,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting XLSX export for ${clients.length} clients`);

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

      // 📝 Log export success
      await this.sendLog({
        method: 'GET',
        url: '/api/clients/export/xlsx',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'CLIENT',
        message: `XLSX export completed successfully`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          clientCount: clients.length,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log('XLSX export completed successfully');
    } catch (error) {
      console.error('Error exporting to XLSX:', error);

      // 📝 Log export error
      await this.sendLog({
        method: 'GET',
        url: '/api/clients/export/xlsx',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'CLIENT',
        message: `XLSX export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          clientCount: clients.length,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Error generating Excel file');
      }
    }
  }

  private async sendLog(logData: {
    method: string;
    url: string;
    statusCode: number;
    operation: string;
    resource: string;
    message: string;
    userId?: string;
    metadata?: any;
    responseTime?: number;
    isError?: boolean;
    errorMessage?: string;
    stackTrace?: string;
  }): Promise<void> {
    try {
      await axios.post(
        this.logsServiceUrl,
        {
          ...logData,
          timestamp: new Date(),
          ipAddress: 'internal',
          userAgent: 'client-service',
        },
        {
          timeout: 5000, // 5 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      // Silent fail - don't let logging break main functionality
      this.logger.warn(`Failed to send log to microservice: ${error.message}`);
    }
  }
}
