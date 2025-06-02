import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { User, UserDocument, UserStatus } from './schema/user.schema';
import { PaginatedResponse } from 'src/comman/pagination.dto';
import { LoginDto } from './dto/login.dto';
import { Response } from 'express';
import * as PDFDocument from 'pdfkit';
import { format } from 'fast-csv';
import * as ExcelJS from 'exceljs';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto): Promise<any> {
    const { username, password } = loginDto;

    // Find user with aggregation to populate related data
    const users = await this.userModel.aggregate([
      {
        $match: {
          username: username,
          status: UserStatus.ACTIVE, // Only allow active users to login
        },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'account',
          // pipeline: [{ $project: { name: 1, _id: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'groups',
          localField: 'groupId',
          foreignField: '_id',
          as: 'group',
          // pipeline: [{ $project: { name: 1, _id: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'roles',
          localField: 'roleId',
          foreignField: '_id',
          as: 'role',
          pipeline: [{ $project: { name: 1, modulePermissions: 1, _id: 1 } }],
        },
      },
      {
        $addFields: {
          account: { $arrayElemAt: ['$account', 0] },
          group: { $arrayElemAt: ['$group', 0] },
          role: { $arrayElemAt: ['$role', 0] },
          fullName: {
            $concat: [
              '$firstName',
              {
                $cond: [
                  { $ne: ['$middleName', null] },
                  { $concat: [' ', '$middleName'] },
                  '',
                ],
              },
              ' ',
              '$lastName',
            ],
          },
        },
      },
      {
        $limit: 1,
      },
    ]);

    if (!users || users.length === 0) {
      throw new UnauthorizedException('Invalid username');
    }

    const user = users[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid  password');
    }

    // Check if user has a role assigned
    if (!user.role) {
      throw new UnauthorizedException('User has no role assigned');
    }

    // Generate JWT token
    const payload = {
      sub: user._id.toString(),
      username: user.username,
      email: user.email,
      roleId: user.roleId?.toString(),
      roleName: user.role?.name,
      permissions: user.role?.permissions || [],
      accountId: user.accountId?.toString(),
      groupId: user.groupId?.toString(),
    };

    const accessToken = this.jwtService.sign(payload);
    const expiresIn = 3600; // 1 hour in seconds

    // Prepare response (exclude password)
    const userResponse = {
      id: user._id.toString(),
      username: user.username,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      contactNo: user.contactNo,
      type: user.type,
      status: user.status,
      account: user.account,
      group: user.group,
      role: user.role,
    };

    return {
      user: userResponse,
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  async validateUser(userId: string): Promise<any> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    try {
      const users = await this.userModel.aggregate([
        {
          $match: {
            _id: new Types.ObjectId(userId),
            status: UserStatus.ACTIVE, // Only validate active users
          },
        },
        {
          $lookup: {
            from: 'accounts',
            localField: 'accountId',
            foreignField: '_id',
            as: 'account',
            pipeline: [{ $project: { accountName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'groups',
            localField: 'groupId',
            foreignField: '_id',
            as: 'group',
            pipeline: [{ $project: { groupName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'roles',
            localField: 'roleId',
            foreignField: '_id',
            as: 'role',
            pipeline: [{ $project: { name: 1, modulePermissions: 1, _id: 1 } }],
          },
        },
        {
          $addFields: {
            account: { $arrayElemAt: ['$account', 0] },
            group: { $arrayElemAt: ['$group', 0] },
            role: { $arrayElemAt: ['$role', 0] },
            fullName: {
              $concat: [
                '$firstName',
                {
                  $cond: [
                    { $ne: ['$middleName', null] },
                    { $concat: [' ', '$middleName'] },
                    '',
                  ],
                },
                ' ',
                '$lastName',
              ],
            },
          },
        },
        {
          $project: {
            password: 0, // Exclude password from response
          },
        },
        {
          $limit: 1,
        },
      ]);

      if (!users || users.length === 0) {
        return null;
      }

      const user = users[0];

      // Check if user has a role assigned (important for authorization)
      if (!user.role) {
        return null;
      }

      return user;
    } catch (error) {
      // Log error if needed
      console.error('Error validating user:', error);
      return null;
    }
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    // Check if username or email already exists
    const existingUser = await this.userModel.findOne({
      $or: [
        { username: createUserDto.username },
        { email: createUserDto.email },
      ],
    });

    if (existingUser) {
      throw new ConflictException('Username or email already exists');
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      saltRounds,
    );

    const userData = {
      ...createUserDto,
      password: hashedPassword,
      accountId: createUserDto.accountId
        ? new Types.ObjectId(createUserDto.accountId)
        : undefined,
      groupId: createUserDto.groupId
        ? new Types.ObjectId(createUserDto.groupId)
        : undefined,
      roleId: new Types.ObjectId(createUserDto.roleId),
    };

    const createdUser = new this.userModel(userData);
    return createdUser.save();
  }

  async findAll(queryDto: UserQueryDto): Promise<PaginatedResponse<any>> {
    const {
      page = 1,
      limit = 10,
      search,
      //   type,
      status,
      accountId,
      groupId,
    } = queryDto;
    const skip = (page - 1) * limit;

    // Build match conditions
    const matchConditions: any = {};

    if (search) {
      matchConditions.$or = [
        { username: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // if (type) matchConditions.type = type;
    if (status) matchConditions.status = status;
    if (accountId) matchConditions.accountId = new Types.ObjectId(accountId);
    if (groupId) matchConditions.groupId = new Types.ObjectId(groupId);

    const aggregationPipeline: any = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'account',
          pipeline: [{ $project: { accountName: 1, _id: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'groups',
          localField: 'groupId',
          foreignField: '_id',
          as: 'group',
          pipeline: [{ $project: { groupName: 1, _id: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'roles',
          localField: 'roleId',
          foreignField: '_id',
          as: 'role',
          pipeline: [{ $project: { name: 1, permissions: 1, _id: 1 } }],
        },
      },
      {
        $addFields: {
          account: { $arrayElemAt: ['$account', 0] },
          group: { $arrayElemAt: ['$group', 0] },
          role: { $arrayElemAt: ['$role', 0] },
          fullName: {
            $concat: [
              '$firstName',
              {
                $cond: [
                  { $ne: ['$middleName', null] },
                  { $concat: [' ', '$middleName'] },
                  '',
                ],
              },
              ' ',
              '$lastName',
            ],
          },
        },
      },
      {
        $project: {
          password: 0,
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    // Get total count
    const totalPipeline = [{ $match: matchConditions }, { $count: 'total' }];

    const [users, totalResult] = await Promise.all([
      this.userModel.aggregate([
        ...aggregationPipeline,
        { $skip: skip },
        { $limit: limit },
      ]),
      this.userModel.aggregate(totalPipeline),
    ]);

    const total = totalResult[0]?.total || 0;

    return new PaginatedResponse(users, page, limit, total);
  }

  async findOne(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid user ID');
    }

    const users = await this.userModel.aggregate([
      { $match: { _id: new Types.ObjectId(id) } },
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'account',
          pipeline: [{ $project: { name: 1, _id: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'groups',
          localField: 'groupId',
          foreignField: '_id',
          as: 'group',
          pipeline: [{ $project: { name: 1, _id: 1 } }],
        },
      },
      {
        $addFields: {
          account: { $arrayElemAt: ['$account', 0] },
          group: { $arrayElemAt: ['$group', 0] },
          role: { $arrayElemAt: ['$role', 0] },
          fullName: {
            $concat: [
              '$firstName',
              {
                $cond: [
                  { $ne: ['$middleName', null] },
                  { $concat: [' ', '$middleName'] },
                  '',
                ],
              },
              ' ',
              '$lastName',
            ],
          },
        },
      },
      {
        $project: {
          password: 0, // Exclude password from response
        },
      },
    ]);

    if (!users || users.length === 0) {
      throw new NotFoundException('User not found');
    }

    return users[0];
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid user ID');
    }

    // Check if username or email already exists (excluding current user)
    if (updateUserDto.username || updateUserDto.email) {
      const conditions: any[] = [];
      if (updateUserDto.username) {
        conditions.push({ username: updateUserDto.username });
      }
      if (updateUserDto.email) {
        conditions.push({ email: updateUserDto.email });
      }

      const existingUser = await this.userModel.findOne({
        $and: [{ _id: { $ne: new Types.ObjectId(id) } }, { $or: conditions }],
      });

      if (existingUser) {
        throw new ConflictException('Username or email already exists');
      }
    }

    const updateData = {
      ...updateUserDto,
      accountId: updateUserDto.accountId
        ? new Types.ObjectId(updateUserDto.accountId)
        : undefined,
      groupId: updateUserDto.groupId
        ? new Types.ObjectId(updateUserDto.groupId)
        : undefined,
      roleId: updateUserDto.roleId
        ? new Types.ObjectId(updateUserDto.roleId)
        : undefined,
    };

    const updatedUser = await this.userModel.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid user ID');
    }

    const result = await this.userModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('User not found');
    }
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid user ID');
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    const result = await this.userModel.findByIdAndUpdate(
      id,
      { password: hashedPassword },
      { new: true },
    );

    if (!result) {
      throw new NotFoundException('User not found');
    }
  }

  async findAllWithoutPagination(): Promise<any[]> {
    try {
      const users = await this.userModel.aggregate([
        {
          $lookup: {
            from: 'accounts',
            localField: 'accountId',
            foreignField: '_id',
            as: 'account',
            pipeline: [{ $project: { accountName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'groups',
            localField: 'groupId',
            foreignField: '_id',
            as: 'group',
            pipeline: [{ $project: { groupName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'roles',
            localField: 'roleId',
            foreignField: '_id',
            as: 'role',
            pipeline: [{ $project: { name: 1, _id: 1 } }],
          },
        },
        {
          $addFields: {
            account: { $arrayElemAt: ['$account', 0] },
            group: { $arrayElemAt: ['$group', 0] },
            role: { $arrayElemAt: ['$role', 0] },
            fullName: {
              $concat: [
                '$firstName',
                {
                  $cond: [
                    { $ne: ['$middleName', null] },
                    { $concat: [' ', '$middleName'] },
                    '',
                  ],
                },
                ' ',
                '$lastName',
              ],
            },
          },
        },
        {
          $project: {
            password: 0, // Exclude password from response
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

      return users;
    } catch (error) {
      throw error;
    }
  }

  exportToPDF(users: any[], res: Response): void {
    try {
      // Create a document with smaller margins and landscape orientation
      const doc = new PDFDocument({
        margin: 20,
        size: 'A4',
        layout: 'landscape', // This gives us more width
      });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=users.pdf');

      doc.pipe(res);

      // Title
      doc.fontSize(16).text('User List', { align: 'center' }).moveDown(1);

      // Calculate available width
      const pageWidth =
        doc.page.width - (doc.page.margins.left + doc.page.margins.right);

      // Define table structure with better width distribution
      const table = {
        headers: [
          { label: 'Username', width: pageWidth * 0.10 }, // 15%
          { label: 'Full Name', width: pageWidth * 0.2 }, // 20%
          { label: 'Email', width: pageWidth * 0.10 }, // 25%
          { label: 'Contact No', width: pageWidth * 0.10 }, // 15%
          { label: 'Status', width: pageWidth * 0.10 }, // 12%
          { label: 'Role', width: pageWidth * 0.10 }, // 13%
          { label: 'Account', width: pageWidth * 0.10 }, // 13%
          { label: 'Group', width: pageWidth * 0.10 }, // 13%
        ],
        rows: users.map((user) => [
          user.username || '',
          user.fullName || '',
          user.email || '',
          user.contactNo || '',
          user.status || '',
          user.role?.name || '',
          user.account?.accountName || '',
          user.group?.groupName || '',
        ]),
        rowHeight: 20,
        margin: { top: 30 },
      };

      // Table drawing position
      const startY = doc.y + table.margin.top;
      let currentY = startY;

      // Draw table headers with background
      doc.font('Helvetica-Bold').fontSize(9);
      let x = doc.page.margins.left;

      // Draw header background
      doc
        .rect(doc.page.margins.left, currentY - 2, pageWidth, table.rowHeight)
        .fill('#f0f0f0')
        .stroke();

      // Reset color for text
      doc.fillColor('black');

      table.headers.forEach((header, i) => {
        doc.text(header.label, x + 2, currentY + 3, {
          width: header.width - 4,
          align: 'left',
          ellipsis: true, // Add ellipsis if text is too long
        });
        x += header.width;
      });

      currentY += table.rowHeight + 5;

      // Draw horizontal line under headers
      doc
        .moveTo(doc.page.margins.left, currentY - 3)
        .lineTo(doc.page.margins.left + pageWidth, currentY - 3)
        .stroke();

      // Draw table rows
      doc.font('Helvetica').fontSize(8);

      table.rows.forEach((row, rowIndex) => {
        // Check if we need a new page
        if (currentY > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          currentY = doc.page.margins.top;

          // Redraw headers on new page
          doc.font('Helvetica-Bold').fontSize(9);
          let headerX = doc.page.margins.left;

          doc
            .rect(
              doc.page.margins.left,
              currentY - 2,
              pageWidth,
              table.rowHeight,
            )
            .fill('#f0f0f0')
            .stroke();

          doc.fillColor('black');

          table.headers.forEach((header, i) => {
            doc.text(header.label, headerX + 2, currentY + 3, {
              width: header.width - 4,
              align: 'left',
              ellipsis: true,
            });
            headerX += header.width;
          });

          currentY += table.rowHeight + 5;
          doc.font('Helvetica').fontSize(8);
        }

        x = doc.page.margins.left;

        // Alternate row colors
        if (rowIndex % 2 === 0) {
          doc
            .rect(
              doc.page.margins.left,
              currentY - 2,
              pageWidth,
              table.rowHeight,
            )
            .fill('#f9f9f9')
            .stroke();
          doc.fillColor('black');
        }

        // Draw each cell in the row
        row.forEach((cell, colIndex) => {
          doc.text(String(cell), x + 2, currentY + 2, {
            width: table.headers[colIndex].width - 4,
            height: table.rowHeight - 4,
            align: 'left',
            ellipsis: true, // Truncate with ellipsis if too long
          });
          x += table.headers[colIndex].width;
        });

        currentY += table.rowHeight;
      });

      // Add footer with page numbers
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .text(
            `Page ${i + 1} of ${pages.count}`,
            doc.page.margins.left,
            doc.page.height - doc.page.margins.bottom + 10,
            { align: 'center' },
          );
      }

      doc.end();
    } catch (error) {
      console.error('Error in exportToPDF:', error);
      if (!res.headersSent) {
        res.status(500).send('Error generating PDF');
      }
    }
  }

  exportToCSV(users: any[], res: Response): void {
    try {
      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=users_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Username',
          'Full Name',
          'First Name',
          'Last Name',
          'Email',
          'Contact No',
          'Type',
          'Status',
          'Account',
          'Group',
          'Role',
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
      users.forEach((user) => {
        csvStream.write({
          Username: user.username || 'N/A',
          'Full Name': user.fullName || 'N/A',
          'First Name': user.firstName || 'N/A',
          'Last Name': user.lastName || 'N/A',
          Email: user.email || 'N/A',
          'Contact No': user.contactNo || 'N/A',
          Type: user.type || 'N/A',
          Status: user.status ? user.status.toUpperCase() : 'UNKNOWN',
          Account: user.account?.accountName || 'N/A',
          Group: user.group?.groupName || 'N/A',
          Role: user.role?.name || 'N/A',
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

  async exportToXLSX(users: any[], res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'User Management System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Users', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        {
          header: 'Username',
          key: 'username',
          width: 20,
          style: { numFmt: '@' },
        },
        { header: 'Full Name', key: 'fullName', width: 25 },
        { header: 'First Name', key: 'firstName', width: 20 },
        { header: 'Last Name', key: 'lastName', width: 20 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Contact No', key: 'contactNo', width: 15 },
        { header: 'Type', key: 'type', width: 15 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Account', key: 'account', width: 20 },
        { header: 'Group', key: 'group', width: 20 },
        { header: 'Role', key: 'role', width: 20 },
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

      // Add data rows with conditional formatting
      users.forEach((user) => {
        const row = worksheet.addRow({
          username: user.username || 'N/A',
          fullName: user.fullName || 'N/A',
          firstName: user.firstName || 'N/A',
          lastName: user.lastName || 'N/A',
          email: user.email || 'N/A',
          contactNo: user.contactNo || 'N/A',
          type: user.type || 'N/A',
          status: user.status ? user.status.toUpperCase() : 'UNKNOWN',
          account: user.account?.accountName || 'N/A',
          group: user.group?.groupName || 'N/A',
          role: user.role?.name || 'N/A',
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        });

        // Style the data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight active users
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
        `attachment; filename=users_${new Date().toISOString().slice(0, 10)}.xlsx`,
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
