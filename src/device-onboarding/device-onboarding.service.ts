import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';
import { Response } from 'express';
import {
  DeviceOnboarding,
  DeviceOnboardingDocument,
} from './schema/device-onboarding.schema';
import { CreateDeviceOnboardingDto } from './dto/create-device-onboarding.dto';
import { DeviceOnboardingQueryDto } from './dto/device-onboaring-query.dto';
import { PaginatedResponse } from 'src/comman/pagination.dto';
import { UpdateDeviceOnboardingDto } from './dto/update-device-onboarding.dto';

@Injectable()
export class DeviceOnboardingService {
  constructor(
    @InjectModel(DeviceOnboarding.name)
    private deviceModel: Model<DeviceOnboardingDocument>,
  ) {}

  async create(
    createDeviceDto: CreateDeviceOnboardingDto,
  ): Promise<DeviceOnboarding> {
    try {
      // Check for duplicate IMEI or Serial Number
      const existingDevice = await this.deviceModel.findOne({
        $or: [
          { deviceIMEI: createDeviceDto.deviceIMEI },
          { deviceSerialNo: createDeviceDto.deviceSerialNo },
        ],
      });

      if (existingDevice) {
        throw new ConflictException(
          'Device with this IMEI or Serial Number already exists',
        );
      }

      const device = new this.deviceModel(createDeviceDto);
      return await device.save();
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          'Device with this IMEI or Serial Number already exists',
        );
      }
      throw error;
    }
  }

  async findAll(
    query: DeviceOnboardingQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const {
      page = 1,
      limit = 10,
      search,
      account,
      vehicle,
      driver,
      isActive,
      simOperator,
    } = query;
    const skip = (page - 1) * limit;

    // Build match conditions
    const matchConditions: any = {};

    if (account) matchConditions.account = new Types.ObjectId(account);
    if (vehicle) matchConditions.vehicle = new Types.ObjectId(vehicle);
    if (driver) matchConditions.driver = new Types.ObjectId(driver);
    if (typeof isActive === 'boolean') matchConditions.isActive = isActive;
    if (simOperator) {
      matchConditions.$or = [
        { simNo1Operator: { $regex: simOperator, $options: 'i' } },
        { simNo2Operator: { $regex: simOperator, $options: 'i' } },
      ];
    }

    // Search functionality
    if (search) {
      matchConditions.$or = [
        ...(matchConditions.$or || []),
        { deviceIMEI: { $regex: search, $options: 'i' } },
        { deviceSerialNo: { $regex: search, $options: 'i' } },
        { simNo1: { $regex: search, $options: 'i' } },
        { simNo2: { $regex: search, $options: 'i' } },
        { vehicleDescription: { $regex: search, $options: 'i' } },
        { simNo1Operator: { $regex: search, $options: 'i' } },
        { simNo2Operator: { $regex: search, $options: 'i' } },
      ];
    }

    const aggregationPipeline: any = [
      { $match: matchConditions },
      {
        $addFields: {
          account: { $toObjectId: '$account' },
          vehicle: { $toObjectId: '$vehicle' },
          driver: { $toObjectId: '$driver' },
          vehicleNo: { $toObjectId: '$vehicleNo' },
        },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'account',
          foreignField: '_id',
          as: 'accountDetails',
        },
      },
      {
        $lookup: {
          from: 'vehiclemasters',
          localField: 'vehicle',
          foreignField: '_id',
          as: 'vehicleDetails',
        },
      },
      {
        $lookup: {
          from: 'drivers',
          localField: 'driver',
          foreignField: '_id',
          as: 'driverDetails',
        },
      },
      {
        $lookup: {
          from: 'vehicles',
          localField: 'vehicleNo',
          foreignField: '_id',
          as: 'vehcileNoDetails',
        },
      },
      {
        $addFields: {
          accountDetails: { $arrayElemAt: ['$accountDetails', 0] },
          vehicleDetails: { $arrayElemAt: ['$vehicleDetails', 0] },
          driverDetails: { $arrayElemAt: ['$driverDetails', 0] },
          vehcileNoDetails: { $arrayElemAt: ['$vehcileNoDetails', 0] },
        },
      },
      {
        $project: {
          _id: 1,
          deviceIMEI: 1,
          deviceSerialNo: 1,
          simNo1: 1,
          simNo2: 1,
          vehcileNo: 1,
          simNo1Operator: 1,
          simNo2Operator: 1,
          vehicleDescription: 1,
          isActive: 1,
          createdAt: 1,
          updatedAt: 1,
          accountDetails: {
            _id: 1,
            accountName: 1,
          },
          vehicleDetails: {
            _id: 1,
            vehicleNumber: 1,
          },
          driverDetails: {
            _id: 1,
            name: 1,
            licenseNo: 1,
            contactNo: 1,
          },
          vehcileNoDetails: {
            brandName: 1,
            modelName: 1,
            vehicleType: 1,
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    // Get total count
    const totalPipeline = [
      ...aggregationPipeline.slice(0, -1), // Remove sort stage for count
      { $count: 'total' },
    ];

    const [devices, totalResult] = await Promise.all([
      this.deviceModel.aggregate([
        ...aggregationPipeline,
        { $skip: Number(skip) },
        { $limit: Number(limit) },
      ]),
      this.deviceModel.aggregate(totalPipeline),
    ]);

    const total = totalResult[0]?.total || 0;
    return new PaginatedResponse(devices, page, limit, total);
  }

  async search(
    search: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<any>> {
    const skip = (page - 1) * limit;
    const regex = { $regex: search, $options: 'i' };

    const pipeline: any[] = [
      {
        $addFields: {
          account: { $toObjectId: '$account' },
          vehicle: { $toObjectId: '$vehicle' },
          driver: { $toObjectId: '$driver' },
          vehicleNo: { $toObjectId: '$vehicleNo' },
        },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'account',
          foreignField: '_id',
          as: 'accountDetails',
        },
      },
      {
        $lookup: {
          from: 'vehiclemasters',
          localField: 'vehicle',
          foreignField: '_id',
          as: 'vehicleDetails',
        },
      },
      {
        $lookup: {
          from: 'drivers',
          localField: 'driver',
          foreignField: '_id',
          as: 'driverDetails',
        },
      },
      {
        $lookup: {
          from: 'vehicles',
          localField: 'vehicleNo',
          foreignField: '_id',
          as: 'vehcileNoDetails',
        },
      },
      {
        $addFields: {
          accountDetails: { $arrayElemAt: ['$accountDetails', 0] },
          vehicleDetails: { $arrayElemAt: ['$vehicleDetails', 0] },
          driverDetails: { $arrayElemAt: ['$driverDetails', 0] },
          vehcileNoDetails: { $arrayElemAt: ['$vehcileNoDetails', 0] },
        },
      },
      {
        $match: {
          $or: [
            { deviceIMEI: regex },
            { deviceSerialNo: regex },
            { simNo1: regex },
            { simNo2: regex },
            { simNo1Operator: regex },
            { simNo2Operator: regex },
            { vehicleDescription: regex },
            { 'accountDetails.accountName': regex },
            { 'vehicleDetails.vehicleNumber': regex },
            { 'driverDetails.name': regex },
            { 'driverDetails.licenseNo': regex },
            { 'driverDetails.contactNo': regex },
            { 'vehcileNoDetails.brandName': regex },
            { 'vehcileNoDetails.modelName': regex },
            { 'vehcileNoDetails.vehicleType': regex },
          ],
        },
      },
      {
        $project: {
          _id: 1,
          deviceIMEI: 1,
          deviceSerialNo: 1,
          simNo1: 1,
          simNo2: 1,
          vehcileNo: 1,
          simNo1Operator: 1,
          simNo2Operator: 1,
          vehicleDescription: 1,
          isActive: 1,
          createdAt: 1,
          updatedAt: 1,
          accountDetails: {
            _id: 1,
            accountName: 1,
          },
          vehicleDetails: {
            _id: 1,
            vehicleNumber: 1,
          },
          driverDetails: {
            _id: 1,
            name: 1,
            licenseNo: 1,
            contactNo: 1,
          },
          vehcileNoDetails: {
            brandName: 1,
            modelName: 1,
            vehicleType: 1,
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    const totalPipeline = [...pipeline, { $count: 'total' }];

    const [results, totalCount] = await Promise.all([
      this.deviceModel.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: limit },
      ]),
      this.deviceModel.aggregate(totalPipeline),
    ]);

    const total = totalCount[0]?.total || 0;
    return new PaginatedResponse(results, page, limit, total);
  }

  async findOne(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid device ID');
    }

    const device = await this.deviceModel.aggregate([
      { $match: { _id: new Types.ObjectId(id) } },
      {
        $addFields: {
          account: { $toObjectId: '$account' },
          vehicle: { $toObjectId: '$vehicle' },
          driver: { $toObjectId: '$driver' },
          vehicleNo: { $toObjectId: '$vehicleNo' },
        },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'account',
          foreignField: '_id',
          as: 'accountDetails',
        },
      },
      {
        $lookup: {
          from: 'vehiclemasters',
          localField: 'vehicle',
          foreignField: '_id',
          as: 'vehicleDetails',
        },
      },
      {
        $lookup: {
          from: 'drivers',
          localField: 'driver',
          foreignField: '_id',
          as: 'driverDetails',
        },
      },
      {
        $lookup: {
          from: 'vehciles',
          localField: 'vehcileNo',
          foreignField: '_id',
          as: 'vehcileNoDetails',
        },
      },
      {
        $addFields: {
          accountDetails: { $arrayElemAt: ['$accountDetails', 0] },
          vehicleDetails: { $arrayElemAt: ['$vehicleDetails', 0] },
          driverDetails: { $arrayElemAt: ['$driverDetails', 0] },
          vehcileNoDetails: { $arrayElemAt: ['$vehcileNoDetails', 0] },
        },
      },
    ]);

    if (!device || device.length === 0) {
      throw new NotFoundException('Device not found');
    }

    return device[0];
  }

  async update(
    id: string,
    updateDeviceDto: UpdateDeviceOnboardingDto,
  ): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid device ID');
    }

    // Check for duplicate IMEI or Serial Number if they are being updated
    if (updateDeviceDto.deviceIMEI || updateDeviceDto.deviceSerialNo) {
      const existingDevice = await this.deviceModel.findOne({
        _id: { $ne: id },
        $or: [
          ...(updateDeviceDto.deviceIMEI
            ? [{ deviceIMEI: updateDeviceDto.deviceIMEI }]
            : []),
          ...(updateDeviceDto.deviceSerialNo
            ? [{ deviceSerialNo: updateDeviceDto.deviceSerialNo }]
            : []),
        ],
      });

      if (existingDevice) {
        throw new ConflictException(
          'Device with this IMEI or Serial Number already exists',
        );
      }
    }

    const device = await this.deviceModel.findByIdAndUpdate(
      id,
      updateDeviceDto,
      { new: true, runValidators: true },
    );

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }

  async deactivate(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid device ID');
    }

    const device = await this.deviceModel.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }

  async activate(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid device ID');
    }

    const device = await this.deviceModel.findByIdAndUpdate(
      id,
      { isActive: true },
      { new: true },
    );

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid device ID');
    }

    const result = await this.deviceModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('Device not found');
    }
  }

  // Export methods
  async findAllWithoutPagination(): Promise<any[]> {
    return await this.deviceModel.aggregate([
      {
        $addFields: {
          account: { $toObjectId: '$account' },
          vehicle: { $toObjectId: '$vehicle' },
          driver: { $toObjectId: '$driver' },
          vehicleNo: { $toObjectId: '$vehicleNo' },
        },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'account',
          foreignField: '_id',
          as: 'accountDetails',
        },
      },
      {
        $lookup: {
          from: 'vehiclemasters',
          localField: 'vehicle',
          foreignField: '_id',
          as: 'vehicleDetails',
        },
      },
      {
        $lookup: {
          from: 'drivers',
          localField: 'driver',
          foreignField: '_id',
          as: 'driverDetails',
        },
      },
      {
        $lookup: {
          from: 'vehicles',
          localField: 'vehicleNo',
          foreignField: '_id',
          as: 'vehcileNoDetails',
        },
      },
      {
        $addFields: {
          accountDetails: { $arrayElemAt: ['$accountDetails', 0] },
          vehicleDetails: { $arrayElemAt: ['$vehicleDetails', 0] },
          driverDetails: { $arrayElemAt: ['$driverDetails', 0] },
          vehcileNoDetails: { $arrayElemAt: ['$vehcileNoDetails', 0] },
        },
      },
      {
        $project: {
          _id: 1,
          deviceIMEI: 1,
          deviceSerialNo: 1,
          simNo1: 1,
          simNo2: 1,
          vehcileNo: 1,
          simNo1Operator: 1,
          simNo2Operator: 1,
          vehicleDescription: 1,
          isActive: 1,
          createdAt: 1,
          updatedAt: 1,
          accountDetails: {
            _id: 1,
            accountName: 1,
          },
          vehicleDetails: {
            _id: 1,
            vehicleNumber: 1,
          },
          driverDetails: {
            _id: 1,
            name: 1,
            licenseNo: 1,
            contactNo: 1,
          },
          vehcileNoDetails: {
            brandName: 1,
            modelName: 1,
            vehicleType: 1,
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ]);
  }

  exportToPDF(devices: any[], res: Response): void {
    try {
      // Create a document with margins
      const doc = new PDFDocument({ margin: 30 });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=device-onboarding.pdf',
      );

      doc.pipe(res);

      // Title
      doc
        .fontSize(18)
        .text('Device Onboarding List', { align: 'center' })
        .moveDown(1);

      // Define table structure
      const table = {
        headers: [
          { label: 'Device IMEI', width: 110 },
          { label: 'Serial No', width: 90 },
          { label: 'SIM 1', width: 80 },
          { label: 'SIM 2', width: 80 },
          { label: 'Account', width: 100 },
          { label: 'Vehicle', width: 90 },
          { label: 'Status', width: 60 },
        ],
        rows: devices.map((device) => [
          device.deviceIMEI || '',
          device.deviceSerialNo || '',
          device.simNo1 || '',
          device.simNo2 || '',
          device.accountDetails?.accountName || '',
          device.vehicleDetails?.vehicleNumber || '',
          device.isActive ? 'Active' : 'Inactive',
        ]),
        rowHeight: 25,
        margin: { top: 40 },
      };

      // Table drawing position
      const startY = doc.y + table.margin.top;
      let currentY = startY;

      // Draw table headers
      doc.font('Helvetica-Bold').fontSize(9);
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
      doc.font('Helvetica').fontSize(8);

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
      console.error('Error exporting to PDF:', error);
      if (!res.headersSent) {
        res.status(500).send('Error generating PDF');
      }
    }
  }

  exportToCSV(devices: any[], res: Response): void {
    try {
      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=device-onboarding_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Device IMEI',
          'Serial Number',
          'SIM 1',
          'SIM 2',
          'SIM 1 Operator',
          'SIM 2 Operator',
          'Vehicle Description',
          'Account Name',
          'Vehicle Number',
          'Driver Name',
          'Driver License',
          'Driver Contact',
          'Status',
          'Created At',
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
          'Device IMEI': device.deviceIMEI || 'N/A',
          'Serial Number': device.deviceSerialNo || 'N/A',
          'SIM 1': device.simNo1 || 'N/A',
          'SIM 2': device.simNo2 || 'N/A',
          'SIM 1 Operator': device.simNo1Operator || 'N/A',
          'SIM 2 Operator': device.simNo2Operator || 'N/A',
          'Vehicle Description': device.vehicleDescription || 'N/A',
          'Account Name': device.accountDetails?.accountName || 'N/A',
          'Vehicle Number': device.vehicleDetails?.vehicleNumber || 'N/A',
          'Driver Name': device.driverDetails?.name || 'N/A',
          'Driver License': device.driverDetails?.licenseNo || 'N/A',
          'Driver Contact': device.driverDetails?.contactNo || 'N/A',
          Status: device.isActive ? 'ACTIVE' : 'INACTIVE',
          'Created At': device.createdAt
            ? new Date(device.createdAt).toLocaleString()
            : 'N/A',
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

  async exportToXLSX(devices: any[], res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Device Onboarding System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Device Onboarding', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        {
          header: 'Device IMEI',
          key: 'deviceIMEI',
          width: 20,
          style: { numFmt: '@' },
        },
        { header: 'Serial Number', key: 'deviceSerialNo', width: 20 },
        { header: 'SIM 1', key: 'simNo1', width: 15 },
        { header: 'SIM 2', key: 'simNo2', width: 15 },
        { header: 'SIM 1 Operator', key: 'simNo1Operator', width: 15 },
        { header: 'SIM 2 Operator', key: 'simNo2Operator', width: 15 },
        { header: 'Vehicle Description', key: 'vehicleDescription', width: 25 },
        { header: 'Account Name', key: 'accountName', width: 20 },
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 15 },
        { header: 'Driver Name', key: 'driverName', width: 20 },
        { header: 'Driver License', key: 'driverLicense', width: 15 },
        { header: 'Driver Contact', key: 'driverContact', width: 15 },
        { header: 'Status', key: 'status', width: 10 },
        {
          header: 'Created At',
          key: 'createdAt',
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
          deviceIMEI: device.deviceIMEI || 'N/A',
          deviceSerialNo: device.deviceSerialNo || 'N/A',
          simNo1: device.simNo1 || 'N/A',
          simNo2: device.simNo2 || 'N/A',
          simNo1Operator: device.simNo1Operator || 'N/A',
          simNo2Operator: device.simNo2Operator || 'N/A',
          vehicleDescription: device.vehicleDescription || 'N/A',
          accountName: device.accountDetails?.accountName || 'N/A',
          vehicleNumber: device.vehicleDetails?.vehicleNumber || 'N/A',
          driverName: device.driverDetails?.name || 'N/A',
          driverLicense: device.driverDetails?.licenseNo || 'N/A',
          driverContact: device.driverDetails?.contactNo || 'N/A',
          status: device.isActive ? 'ACTIVE' : 'INACTIVE',
          createdAt: device.createdAt,
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
        `attachment; filename=device-onboarding_${new Date().toISOString().slice(0, 10)}.xlsx`,
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

  // Additional utility methods
  async getDevicesByAccount(accountId: string): Promise<any[]> {
    if (!Types.ObjectId.isValid(accountId)) {
      throw new NotFoundException('Invalid account ID');
    }

    return await this.deviceModel
      .find({
        account: new Types.ObjectId(accountId),
        isActive: true,
      })
      .populate(['vehicle', 'driver']);
  }

  async getDevicesByVehicle(vehicleId: string): Promise<any[]> {
    if (!Types.ObjectId.isValid(vehicleId)) {
      throw new NotFoundException('Invalid vehicle ID');
    }

    return await this.deviceModel
      .find({
        vehicle: new Types.ObjectId(vehicleId),
        isActive: true,
      })
      .populate(['account', 'driver']);
  }

  async getDeviceStats(): Promise<any> {
    return await this.deviceModel.aggregate([
      {
        $group: {
          _id: null,
          totalDevices: { $sum: 1 },
          activeDevices: {
            $sum: { $cond: ['$isActive', 1, 0] },
          },
          inactiveDevices: {
            $sum: { $cond: ['$isActive', 0, 1] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalDevices: 1,
          activeDevices: 1,
          inactiveDevices: 1,
        },
      },
    ]);
  }
}
