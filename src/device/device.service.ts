import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Device, DeviceDocument } from './schema/device.schema';
import { CreateDeviceDto } from './dto/create-device.dto';
import { v4 as uuidv4 } from 'uuid';
import * as PDFDocument from 'pdfkit';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
  ) {}

  async create(createDeviceDto: CreateDeviceDto): Promise<Device> {
    try {
      this.logger.log(
        `Checking for duplicate device with modelName: ${createDeviceDto.modelName}`,
      );

      // Check for existing device by modelName
      const existingDevice = await this.deviceModel.findOne({
        modelName: createDeviceDto.modelName,
      });

      if (existingDevice) {
        throw new Error(
          `Device with modelName "${createDeviceDto.modelName}" already exists.`,
        );
      }

      // Generate unique deviceId
      const deviceId = uuidv4(); // or use any custom generator
      createDeviceDto.deviceId = deviceId;

      this.logger.log(`Creating device with generated ID: ${deviceId}`);
      const createdDevice = new this.deviceModel(createDeviceDto);
      const savedDevice = await createdDevice.save();

      return savedDevice;
    } catch (error) {
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
  ): Promise<{ devices: Device[]; total: number }> {
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
      return { devices, total };
    } catch (error) {
      this.logger.error(
        `Failed to retrieve devices: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findOne(id: string) {
    try {
      this.logger.log(`Finding device with ID: ${id}`);
      const device = await this.deviceModel.findById(id).exec();
      if (device) {
        this.logger.log(`Device found with ID: ${id}`);
      } else {
        this.logger.warn(`No device found with ID: ${id}`);
      }
      return device;
    } catch (error) {
      this.logger.error(
        `Failed to find device with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findByDeviceId(deviceId: string) {
    try {
      this.logger.log(`Finding device with device ID: ${deviceId}`);
      const device = await this.deviceModel.findOne({ deviceId }).exec();
      if (device) {
        this.logger.log(`Device found with device ID: ${deviceId}`);
      } else {
        this.logger.warn(`No device found with device ID: ${deviceId}`);
      }
      return device;
    } catch (error) {
      this.logger.error(
        `Failed to find device with device ID ${deviceId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async update(id: string, updateDeviceDto: Partial<CreateDeviceDto>) {
    try {
      this.logger.log(`Updating device with ID: ${id}`);
      const updatedDevice = await this.deviceModel
        .findByIdAndUpdate(id, updateDeviceDto, { new: true })
        .exec();

      if (updatedDevice) {
        this.logger.log(`Device updated successfully with ID: ${id}`);
      } else {
        this.logger.warn(`No device found to update with ID: ${id}`);
      }
      return updatedDevice;
    } catch (error) {
      this.logger.error(
        `Failed to update device with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async remove(id: string) {
    try {
      this.logger.log(`Deleting device with ID: ${id}`);
      const deletedDevice = await this.deviceModel.findByIdAndDelete(id).exec();

      if (deletedDevice) {
        this.logger.log(`Device deleted successfully with ID: ${id}`);
      } else {
        this.logger.warn(`No device found to delete with ID: ${id}`);
      }
      return deletedDevice;
    } catch (error) {
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
  ): Promise<{ devices: Device[]; total: number }> {
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

    return { devices, total };
  }

  async findAllWithoutPagination(): Promise<Device[]> {
    return this.deviceModel.find().exec();
  }

  exportToPDF(devices: Device[], res: Response): void {
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
  }

  exportToCSV(devices: Device[], res: Response): void {
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
  async exportToXLSX(devices: Device[], res: Response): Promise<void> {
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
    } catch (error) {
      console.error('Error exporting to XLSX:', error);
      if (!res.headersSent) {
        res.status(500).send('Error generating Excel file');
      }
    }
  }
}
