import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Device, DeviceDocument } from './schema/device.schema';
import { CreateDeviceDto } from './dto/create-device.dto';
import { v4 as uuidv4 } from 'uuid';
import * as PDFDocument from 'pdfkit';

import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';
import { Response } from 'express';
import axios from 'axios';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:9008/logs';

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
  ) {}

  async create(
    createDeviceDto: CreateDeviceDto,
    userId?: string,
  ): Promise<Device> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Checking for duplicate device with modelName: ${createDeviceDto.modelName}`,
      );

      // Check for existing device by modelName
      const existingDevice = await this.deviceModel.findOne({
        modelName: createDeviceDto.modelName,
      });

      if (existingDevice) {
        const errorMessage = `Device with modelName "${createDeviceDto.modelName}" already exists.`;

        // 📝 Log duplicate error (only error log)
        await this.sendLog({
          method: 'POST',
          url: '/api/devices',
          statusCode: 409,
          operation: 'CREATE',
          resource: 'DEVICE',
          message: 'Device creation failed - duplicate modelName',
          userId,
          metadata: {
            requestData: createDeviceDto,
            existingDeviceId: existingDevice.deviceId,
            errorType: 'DUPLICATE_ENTRY',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new Error(errorMessage);
      }

      // Generate unique deviceId
      const deviceId = uuidv4();
      createDeviceDto.deviceId = deviceId;

      this.logger.log(`Creating device with generated ID: ${deviceId}`);

      const createdDevice = new this.deviceModel(createDeviceDto);
      const savedDevice = await createdDevice.save();

      // 📝 Log successful creation (only success log)
      await this.sendLog({
        method: 'POST',
        url: '/api/devices',
        statusCode: 201,
        operation: 'CREATE',
        resource: 'DEVICE',
        message: `Device created successfully: ${savedDevice.modelName}`,
        userId,
        metadata: {
          deviceId: savedDevice.deviceId,
          modelName: savedDevice.modelName,
          requestData: createDeviceDto,
        },
        responseTime: Date.now() - startTime,
      });

      return savedDevice;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (!error.message.includes('already exists')) {
        await this.sendLog({
          method: 'POST',
          url: '/api/devices',
          statusCode: 500,
          operation: 'CREATE',
          resource: 'DEVICE',
          message: `Device creation failed: ${error.message}`,
          userId,
          metadata: {
            requestData: createDeviceDto,
            errorType: error.name,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to create device: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    userId?: string,
  ): Promise<{ devices: Device[]; total: number }> {
    const startTime = Date.now();

    try {
      this.logger.log(`Retrieving devices - Page: ${page}, Limit: ${limit}`);

      const skip = (page - 1) * limit;

      const [devices, total] = await Promise.all([
        this.deviceModel.find().skip(skip).limit(limit).exec(),
        this.deviceModel.countDocuments().exec(),
      ]);

      this.logger.log(
        `Retrieved ${devices.length} devices out of ${total} total devices`,
      );

      // 📝 Log successful retrieval (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/devices',
        statusCode: 200,
        operation: 'READ',
        resource: 'DEVICE',
        message: `Successfully retrieved ${devices.length} devices`,
        userId,
        metadata: {
          page,
          limit,
          retrievedCount: devices.length,
          totalCount: total,
        },
        responseTime: Date.now() - startTime,
      });

      return { devices, total };
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/devices',
        statusCode: 500,
        operation: 'READ',
        resource: 'DEVICE',
        message: `Failed to retrieve devices: ${error.message}`,
        userId,
        metadata: { page, limit },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to retrieve devices: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findOne(id: string, userId?: string) {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding device with ID: ${id}`);

      const device = await this.deviceModel.findById(id).exec();

      if (device) {
        this.logger.log(`Device found with ID: ${id}`);

        // 📝 Log successful find (only success log)
        await this.sendLog({
          method: 'GET',
          url: `/api/devices/${id}`,
          statusCode: 200,
          operation: 'READ',
          resource: 'DEVICE',
          message: `Device found successfully`,
          userId,
          metadata: {
            deviceId: id,
            foundDeviceId: device.deviceId,
            modelName: device.modelName,
          },
          responseTime: Date.now() - startTime,
        });
      } else {
        this.logger.warn(`No device found with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'GET',
          url: `/api/devices/${id}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'DEVICE',
          message: `Device not found with ID: ${id}`,
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
        });
      }

      return device;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: `/api/devices/${id}`,
        statusCode: 500,
        operation: 'READ',
        resource: 'DEVICE',
        message: `Failed to find device: ${error.message}`,
        userId,
        metadata: { deviceId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to find device with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findByDeviceId(deviceId: string, userId?: string) {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding device with device ID: ${deviceId}`);

      const device = await this.deviceModel.findOne({ deviceId }).exec();

      if (device) {
        this.logger.log(`Device found with device ID: ${deviceId}`);

        // 📝 Log successful find (only success log)
        await this.sendLog({
          method: 'GET',
          url: `/api/devices/device-id/${deviceId}`,
          statusCode: 200,
          operation: 'READ',
          resource: 'DEVICE',
          message: `Device found successfully by device ID`,
          userId,
          metadata: {
            deviceId,
            modelName: device.modelName,
            _id: device._id,
          },
          responseTime: Date.now() - startTime,
        });
      } else {
        this.logger.warn(`No device found with device ID: ${deviceId}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'GET',
          url: `/api/devices/device-id/${deviceId}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'DEVICE',
          message: `Device not found with device ID: ${deviceId}`,
          userId,
          metadata: { deviceId },
          responseTime: Date.now() - startTime,
        });
      }

      return device;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: `/api/devices/device-id/${deviceId}`,
        statusCode: 500,
        operation: 'READ',
        resource: 'DEVICE',
        message: `Failed to find device by device ID: ${error.message}`,
        userId,
        metadata: { deviceId },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to find device with device ID ${deviceId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async update(
    id: string,
    updateDeviceDto: Partial<CreateDeviceDto>,
    userId?: string,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log(`Updating device with ID: ${id}`);

      const updatedDevice = await this.deviceModel
        .findByIdAndUpdate(id, updateDeviceDto, { new: true })
        .exec();

      if (updatedDevice) {
        this.logger.log(`Device updated successfully with ID: ${id}`);

        // 📝 Log successful update (only success log)
        await this.sendLog({
          method: 'PUT',
          url: `/api/devices/${id}`,
          statusCode: 200,
          operation: 'UPDATE',
          resource: 'DEVICE',
          message: `Device updated successfully: ${updatedDevice.modelName}`,
          userId,
          metadata: {
            deviceId: id,
            updatedDeviceId: updatedDevice.deviceId,
            modelName: updatedDevice.modelName,
            updateData: updateDeviceDto,
          },
          responseTime: Date.now() - startTime,
        });
      } else {
        this.logger.warn(`No device found to update with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'PUT',
          url: `/api/devices/${id}`,
          statusCode: 404,
          operation: 'UPDATE',
          resource: 'DEVICE',
          message: `Device not found for update with ID: ${id}`,
          userId,
          metadata: {
            deviceId: id,
            updateData: updateDeviceDto,
          },
          responseTime: Date.now() - startTime,
        });
      }

      return updatedDevice;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'PUT',
        url: `/api/devices/${id}`,
        statusCode: 500,
        operation: 'UPDATE',
        resource: 'DEVICE',
        message: `Device update failed: ${error.message}`,
        userId,
        metadata: {
          deviceId: id,
          updateData: updateDeviceDto,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to update device with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async remove(id: string, userId?: string) {
    const startTime = Date.now();

    try {
      this.logger.log(`Deleting device with ID: ${id}`);

      const deletedDevice = await this.deviceModel.findByIdAndDelete(id).exec();

      if (deletedDevice) {
        this.logger.log(`Device deleted successfully with ID: ${id}`);

        // 📝 Log successful deletion (only success log)
        await this.sendLog({
          method: 'DELETE',
          url: `/api/devices/${id}`,
          statusCode: 200,
          operation: 'DELETE',
          resource: 'DEVICE',
          message: `Device deleted successfully: ${deletedDevice.modelName}`,
          userId,
          metadata: {
            deviceId: id,
            deletedDeviceId: deletedDevice.deviceId,
            modelName: deletedDevice.modelName,
          },
          responseTime: Date.now() - startTime,
        });
      } else {
        this.logger.warn(`No device found to delete with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'DELETE',
          url: `/api/devices/${id}`,
          statusCode: 404,
          operation: 'DELETE',
          resource: 'DEVICE',
          message: `Device not found for deletion with ID: ${id}`,
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
        });
      }

      return deletedDevice;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'DELETE',
        url: `/api/devices/${id}`,
        statusCode: 500,
        operation: 'DELETE',
        resource: 'DEVICE',
        message: `Device deletion failed: ${error.message}`,
        userId,
        metadata: { deviceId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to delete device with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async searchDevices(
    searchText: string,
    page = 1,
    limit = 10,
    userId?: string,
  ): Promise<{ devices: Device[]; total: number }> {
    const startTime = Date.now();

    try {
      const query: any = {};

      if (searchText) {
        const regex = new RegExp(searchText, 'i');
        query.$or = [
          { modelName: regex },
          { deviceType: regex },
          { manufacturerName: regex },
          { ipAddress: regex },
          { status: regex },
          { deviceId: regex },
        ];
      }

      const [devices, total] = await Promise.all([
        this.deviceModel
          .find(query)
          .skip((page - 1) * limit)
          .limit(limit)
          .exec(),
        this.deviceModel.countDocuments(query),
      ]);

      // 📝 Log search success (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/devices/search',
        statusCode: 200,
        operation: 'SEARCH',
        resource: 'DEVICE',
        message: `Device search completed - found ${devices.length} devices`,
        userId,
        metadata: {
          searchText,
          page,
          limit,
          foundCount: devices.length,
          totalCount: total,
        },
        responseTime: Date.now() - startTime,
      });

      return { devices, total };
    } catch (error) {
      // 📝 Log search error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/devices/search',
        statusCode: 500,
        operation: 'SEARCH',
        resource: 'DEVICE',
        message: `Device search failed: ${error.message}`,
        userId,
        metadata: {
          searchText,
          page,
          limit,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }

  async findAllWithoutPagination(userId?: string): Promise<Device[]> {
    const startTime = Date.now();

    try {
      const devices = await this.deviceModel.find().exec();

      // 📝 Log success (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/devices/all',
        statusCode: 200,
        operation: 'READ',
        resource: 'DEVICE',
        message: `Retrieved all ${devices.length} devices`,
        userId,
        metadata: { totalCount: devices.length },
        responseTime: Date.now() - startTime,
      });

      return devices;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/devices/all',
        statusCode: 500,
        operation: 'READ',
        resource: 'DEVICE',
        message: `Failed to retrieve all devices: ${error.message}`,
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }

  exportToPDF(devices: Device[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      // Create a document with margins
      const doc = new PDFDocument({ margin: 30 });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=devices.pdf');

      doc.pipe(res);

      // Title
      doc.fontSize(18).text('Device List', { align: 'center' }).moveDown(1);

      // Define table structure
      const table = {
        headers: [
          { label: 'Device ID', width: 100 },
          { label: 'Model Name', width: 120 },
          { label: 'Type', width: 80 },
          { label: 'Manufacturer', width: 120 },
          { label: 'IP Address', width: 100 },
          { label: 'Status', width: 80 },
        ],
        rows: devices.map((device) => [
          device.deviceId || '',
          device.modelName || '',
          device.deviceType || '',
          device.manufacturerName || '',
          device.ipAddress || '',
          device.status || '',
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

      // 📝 Log export success (only success log)
      this.sendLog({
        method: 'GET',
        url: '/api/devices/export/pdf',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'DEVICE',
        message: `PDF export completed successfully`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          deviceCount: devices.length,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      // 📝 Log export error (only error log)
      this.sendLog({
        method: 'GET',
        url: '/api/devices/export/pdf',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'DEVICE',
        message: `PDF export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          deviceCount: devices.length,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });
    }
  }

  exportToCSV(devices: Device[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=devices_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Device ID',
          'Model Name',
          'Type',
          'Manufacturer',
          'IP Address',
          'Port',
          'Status',
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
      devices.forEach((device) => {
        csvStream.write({
          'Device ID': device.deviceId || 'N/A',
          'Model Name': device.modelName || 'N/A',
          Type: device.deviceType || 'N/A',
          Manufacturer: device.manufacturerName || 'N/A',
          'IP Address': device.ipAddress || 'N/A',
          Port: device.port || 'N/A',
          Status: device.status ? device.status.toUpperCase() : 'UNKNOWN',
        });
      });

      // Handle stream events
      csvStream.on('error', (error) => {
        console.error('CSV stream error:', error);
        // 📝 Log CSV error (only error log)
        this.sendLog({
          method: 'GET',
          url: '/api/devices/export/csv',
          statusCode: 500,
          operation: 'EXPORT',
          resource: 'DEVICE',
          message: `CSV export failed: ${error.message}`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            deviceCount: devices.length,
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
        // 📝 Log export success (only success log)
        this.sendLog({
          method: 'GET',
          url: '/api/devices/export/csv',
          statusCode: 200,
          operation: 'EXPORT',
          resource: 'DEVICE',
          message: `CSV export completed successfully`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            deviceCount: devices.length,
          },
          responseTime: Date.now() - startTime,
        });
      });

      csvStream.end();
    } catch (error) {
      console.error('Error in exportToCSV:', error);
      // 📝 Log export error (only error log)
      this.sendLog({
        method: 'GET',
        url: '/api/devices/export/csv',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'DEVICE',
        message: `CSV export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'CSV',
          deviceCount: devices.length,
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
    devices: Device[],
    res: Response,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Your Application Name';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Devices', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        {
          header: 'Device ID',
          key: 'deviceId',
          width: 36,
          style: { numFmt: '@' },
        }, // Treat as text
        { header: 'Model Name', key: 'modelName', width: 25 },
        { header: 'Type', key: 'deviceType', width: 15 },
        { header: 'Manufacturer', key: 'manufacturerName', width: 20 },
        { header: 'IP Address', key: 'ipAddress', width: 15 },
        { header: 'Port', key: 'port', width: 10 },
        { header: 'Status', key: 'status', width: 15 },
        {
          header: 'Created At',
          key: 'createdAt',
          width: 20,
          style: { numFmt: 'yyyy-mm-dd hh:mm:ss' },
        },
        {
          header: 'Last Updated',
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

      // Add data rows with conditional formatting
      devices.forEach((device) => {
        const row = worksheet.addRow({
          deviceId: device.deviceId || 'N/A',
          modelName: device.modelName || 'N/A',
          deviceType: device.deviceType || 'N/A',
          manufacturerName: device.manufacturerName || 'N/A',
          ipAddress: device.ipAddress || 'N/A',
          port: device.port || 'N/A',
          status: device.status ? device.status.toUpperCase() : 'UNKNOWN',
          // createdAt: device.createdAt,
          // updatedAt: device.updatedAt,
        });

        // Style the data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight active devices
          if (cell.value === 'ACTIVE') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC6EFCE' }, // Light green
            };
          }
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
        `attachment; filename=devices_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();

      // 📝 Log export success (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/devices/export/xlsx',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'DEVICE',
        message: `XLSX export completed successfully`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          deviceCount: devices.length,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Error exporting to XLSX:', error);

      // 📝 Log export error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/devices/export/xlsx',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'DEVICE',
        message: `XLSX export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          deviceCount: devices.length,
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
          userAgent: 'device-service',
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
