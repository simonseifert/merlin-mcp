// Mirror of src/dashboard.ts (server). Keep the two in step.
export type EventKind = 'exam' | 'seminar' | 'deadline' | 'class' | 'event';

export interface GradeItem {
	name: string;
	module?: string;
	raw?: number;
	min?: number;
	max?: number;
	formatted?: string;
	percent?: number;
	weight?: string;
	feedback?: string;
	graded_at?: number;
}
export interface DashCourse {
	key: string;
	id: number;
	year: string;
	name: string;
	shortname?: string;
	total?: { raw?: number; max?: number; percent?: number; formatted?: string };
	items: GradeItem[];
	error?: string;
}
export interface DashEvent {
	key: string;
	year: string;
	title: string;
	kind: EventKind;
	course?: string;
	courseid?: number;
	start: number;
	duration?: number;
	location?: string;
	description?: string;
	url?: string;
	todo?: boolean;
}
export interface DashAnnouncement {
	key: string;
	year: string;
	course?: string;
	forum?: string;
	subject: string;
	author?: string;
	created: number;
	message?: string;
	kind?: EventKind;
}
export interface DashSeminar {
	key: string;
	year: string;
	title: string;
	course?: string;
	due?: number;
	intro?: string;
	source: 'assignment' | 'calendar';
}
export interface Dashboard {
	generated_at: number;
	year: string;
	years: string[];
	user?: { fullname?: string; firstname?: string; site?: string };
	courses: DashCourse[];
	events: DashEvent[];
	exams: DashEvent[];
	seminars: DashSeminar[];
	announcements: DashAnnouncement[];
	errors?: Array<{ part: string; error: string }>;
}

/** GET /api/dashboard?part=grades: points per course, merged into Dashboard.courses by key. */
export interface DashGrades {
	generated_at: number;
	year: string;
	courses: Array<Pick<DashCourse, 'key' | 'total' | 'items' | 'error'>>;
	errors?: Array<{ part: string; error: string }>;
}

/** GET /api/dashboard?part=announcements. */
export interface DashAnnouncements {
	generated_at: number;
	year: string;
	announcements: DashAnnouncement[];
	errors?: Array<{ part: string; error: string }>;
}
