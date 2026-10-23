import { Transform } from 'class-transformer';
import {
  IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { COMPLAINT_CATEGORIES, COMPLAINT_PRIORITIES, ComplaintStatus } from '../common/roles';

/** form-string भी number बन जाए (पूरे backend की परिपाटी). */
const Num = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  });

const Str = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s;
  });

/** ग्राहक (public order token) / दुकानदार — दोनों का दर्ज करने का body. */
export class CreateComplaintDto {
  @IsIn(COMPLAINT_CATEGORIES as unknown as string[], { message: 'शिकायत की कैटेगरी चुनें' })
  category!: string;

  @IsString() @Length(10, 2000, { message: 'विवरण 10–2000 अक्षर' })
  body!: string;

  @IsOptional() @IsIn(COMPLAINT_PRIORITIES as unknown as string[])
  priority?: string;

  /** public (guest) filing पर optional — order के ग्राहक से default. */
  @ValidateIf((o: CreateComplaintDto) => o.customerName !== undefined)
  @IsOptional() @IsString() @MaxLength(80)
  customerName?: string;

  @ValidateIf((o: CreateComplaintDto) => o.customerPhone !== undefined)
  @IsOptional() @IsString() @MaxLength(15)
  customerPhone?: string;
}

/** POST /admin/complaints/:id/status — { action: START|RESOLVE|CLOSE|REOPEN, note? } */
export class ComplaintActionDto {
  @IsIn(['START', 'RESOLVE', 'CLOSE', 'REOPEN'], { message: 'काम START/RESOLVE/CLOSE/REOPEN में भेजें' })
  action!: string;

  @ValidateIf((o: ComplaintActionDto) => o.action === 'RESOLVE')
  @IsString() @Length(5, 1000, { message: 'RESOLVE पर हल-नोट (5+ अक्षर) ज़रूरी' })
  note?: string;

  @IsOptional() @IsString()
  noteAny?: string;

  /** सिर्फ़ SUPER_ADMIN/ADMIN किसी और को सौंप सकते हैं (SUPPORT ख़ुद को ही). */
  @IsOptional() @IsString()
  assignTo?: string;
}

/** POST /admin/complaints/:id/note — internal टिप्पणी धागा. */
export class ComplaintNoteDto {
  @IsString() @Length(2, 1000, { message: 'नोट 2–1000 अक्षर' })
  body!: string;

  @IsOptional()
  isInternal?: boolean;
}

/** GET /admin/complaints — सूची फ़िल्टर. */
export class ListComplaintsQueryDto {
  @IsOptional() @IsIn(Object.values(ComplaintStatus))
  status?: string;

  @IsOptional() @IsIn(COMPLAINT_PRIORITIES as unknown as string[])
  priority?: string;

  @IsOptional() @Str() @IsString() @MaxLength(40)
  shopId?: string;

  /** 'me' = मेरे सौंपे · 'unassigned' = किसी के नहीं. */
  @IsOptional() @IsIn(['me', 'unassigned'])
  assigned?: string;

  @IsOptional() @Str() @IsString() @MaxLength(60)
  q?: string;

  @IsOptional() @Num() @IsInt() @Min(1) @Max(500)
  page?: number;

  @IsOptional() @Num() @IsInt() @Min(1) @Max(100)
  limit?: number;
}
